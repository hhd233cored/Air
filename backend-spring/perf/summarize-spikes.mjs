import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node perf/summarize-spikes.mjs fullchain.jsonl output-prefix');
const read=p=>readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const raw=read(input),summaries=raw.filter(r=>r.event==='fullchain-summary'),result=[],timeline=[],pgIntervals=[];
const jdbcRows=execFileSync(process.execPath,[fileURLToPath(new URL('summarize-http-jdbc.mjs',import.meta.url)),...summaries.map(r=>r.prefix)],{maxBuffer:32*1024*1024}).toString().trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
export function durationMs(s){const m=/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(s);if(!m)throw Error('Invalid JFR duration '+s);return (Number(m[1]??0)*3600+Number(m[2]??0)*60+Number(m[3]??0))*1000;}
const round=n=>n==null?null:Number(n.toFixed(3));
const max=a=>a.length?a.reduce((m,n)=>Math.max(m,n),-Infinity):null;
const overlap=(e,from,to)=>Math.max(0,Math.min(to,e.end)-Math.max(from,e.start));
const sumOverlap=(a,from,to)=>round(a.reduce((n,e)=>n+overlap(e,from,to),0));
function csv(path,rows){assert.ok(rows.length);const keys=Object.keys(rows[0]);const cell=v=>v==null?'':'"'+String(v).replaceAll('"','""')+'"';writeFileSync(path,[keys.join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\n')+'\n');}
for(const r of summaries){
 const events=read(r.prefix+'.jsonl'),start=events.find(e=>e.event==='burst-start').atEpochMs,end=events.find(e=>e.event==='burst-end').atEpochMs;
 assert.equal(r.businessChecks,'PASS');assert.equal(r.config.poolSize,20);assert.equal(r.config.publisherMaxBatches,4);
 const observer=events.find(e=>e.event==='observer-process');assert.ok(observer&&observer.pid!==observer.generatorPid);
 const jfr=read(r.prefix+'-jfr-events.jsonl').map(e=>({...e,start:Date.parse(e.startTime),durationMs:durationMs(e.duration)})).map(e=>({...e,end:e.start+e.durationMs}));
 assert.ok(jfr.some(e=>e.start<=start)&&jfr.some(e=>e.start>=end),'JFR does not cover full burst');
 const pauses=jfr.filter(e=>e.type==='jdk.GCPhasePause'),pool=jfr.filter(e=>e.type==='jdk.ThreadPark'&&(e.role==='hikariPark'||e.stack.some(s=>s.includes('com.zaxxer.hikari.pool.HikariPool.getConnection')))),
  pgSocket=jfr.filter(e=>['jdk.SocketRead','jdk.SocketWrite'].includes(e.type)&&(e.role==='postgresSocket'||e.role==='commitSocket'||e.stack.some(s=>s.startsWith('org.postgresql.')))),
  commitSocket=pgSocket.filter(e=>e.role==='commitSocket'||e.stack.includes('org.postgresql.jdbc.PgConnection.commit')),
  httpCommitSocket=commitSocket.filter(e=>e.thread?.startsWith('http-nio-'));
 const httpPool=pool.filter(e=>e.thread?.startsWith('http-nio-')),nonHttpPool=pool.filter(e=>!e.thread?.startsWith('http-nio-'));
 // Other scheduled jobs (for example music import) still use the primary pool.
 const articleBackgroundPool=nonHttpPool.filter(e=>e.stack.some(s=>
  ['ArticleMetricRepository','ArticleMetricOutboxPublisher','ArticleMetricConsumer'].some(name=>s.startsWith('org.airchord.backend.metrics.'+name))));
 const inWindow=a=>a.filter(e=>e.start<end&&e.end>=start);
 const baseline=events.find(e=>e.event==='postgres-snapshot'&&e.phase==='before-burst');
 const settings=Object.fromEntries(baseline.settings.map(s=>[s.name,s.setting]));
 assert.equal(settings.fsync,'on');assert.equal(settings.synchronous_commit,'on');
 for(const p of read(r.prefix+'-publisher.jsonl').filter(p=>p.startedAtEpochMs>=start&&p.startedAtEpochMs<=events.find(e=>e.event==='pipeline-drained').atEpochMs))assert.equal(p.maxBatchesPerRun,4);
 const snapshots=[baseline,...events.filter(e=>e.event==='postgres-interval'&&!e.probeError),events.find(e=>e.event==='postgres-snapshot'&&e.phase==='after-drain')].sort((a,b)=>a.endedAtEpochMs-b.endedAtEpochMs);
 const walField=(s,key)=>s.io.filter(i=>i.object==='wal').reduce((n,i)=>n+(i[key]??0),0);
 const autovacField=(s,key)=>s.io.filter(i=>i.backend_type==='autovacuum worker').reduce((n,i)=>n+(i[key]??0),0);
 const checkpointIoField=(s,key)=>s.io.filter(i=>i.backend_type==='checkpointer'&&i.object==='relation').reduce((n,i)=>n+(i[key]??0),0);
 const intervals=[];
 for(let i=1;i<snapshots.length;i++){
  const a=snapshots[i-1],b=snapshots[i];assert.equal(a.wal.stats_reset,b.wal.stats_reset);
  const delta=(x,y)=>{assert.ok(y-x>=-.001,'PG cumulative counter decreased');return round(y-x);};
  const fsyncs=delta(walField(a,'fsyncs'),walField(b,'fsyncs')),fsyncMs=delta(walField(a,'fsync_time'),walField(b,'fsync_time'));
  const interval={label:r.config.label,fromEpochMs:a.endedAtEpochMs,toEpochMs:b.endedAtEpochMs,
    fromSecond:round((a.endedAtEpochMs-start)/1000),toSecond:round((b.endedAtEpochMs-start)/1000),
    seconds:round((b.endedAtEpochMs-a.endedAtEpochMs)/1000),walFsyncs:fsyncs,walFsyncMs:fsyncMs,walFsyncAvgMs:fsyncs?round(fsyncMs/fsyncs):null,
    walBytes:delta(a.wal.wal_bytes,b.wal.wal_bytes),xactCommit:delta(a.database.xact_commit,b.database.xact_commit),
    checkpointsTimed:delta(a.checkpoints.num_timed,b.checkpoints.num_timed),checkpointsRequested:delta(a.checkpoints.num_requested,b.checkpoints.num_requested),checkpointsDone:delta(a.checkpoints.num_done,b.checkpoints.num_done),
    checkpointWriteMs:delta(a.checkpoints.write_time,b.checkpoints.write_time),checkpointSyncMs:delta(a.checkpoints.sync_time,b.checkpoints.sync_time),
    checkpointIoWriteMs:delta(checkpointIoField(a,'write_time'),checkpointIoField(b,'write_time')),checkpointIoFsyncMs:delta(checkpointIoField(a,'fsync_time'),checkpointIoField(b,'fsync_time')),
    autovacReadMs:delta(autovacField(a,'read_time'),autovacField(b,'read_time')),autovacWriteMs:delta(autovacField(a,'write_time'),autovacField(b,'write_time'))};
  intervals.push(interval);pgIntervals.push(interval);
 }
 const rows=raw.filter(e=>e.event==='fullchain-timeline'&&e.prefix===r.prefix).map(t=>{
  const from=t.secondStartEpochMs,to=from+1000,probes=events.filter(e=>e.event==='wait-sample'&&e.sampledAtEpochMs>=from&&e.sampledAtEpochMs<to),
   http=events.find(e=>e.event==='http-transport-completed-second'&&e.secondStartEpochMs===from),jdbc=jdbcRows.find(e=>e.event==='http-jdbc-timeline'&&e.prefix===r.prefix&&e.secondStartEpochMs===from),cpu=jfr.filter(e=>e.type==='jdk.CPULoad'&&e.start>=from&&e.start<to),
   pg=intervals.find(i=>i.fromEpochMs<=from&&i.toEpochMs>from);
  const row={label:r.config.label,second:t.second,epochMs:from,httpCompleted:t.httpCompleted,
   httpP95Ms:http?.stages.clientTotal?.p95Ms??null,acquireAvgMs:t.acquireAvgMs,jdbcCommitAvgMs:t.jdbcCommitAvgMs,
   jdbcHoldAvgMs:t.jdbcHoldAvgMs,accountExecuteAvgMs:jdbc?.stages.jdbcAccount?.avgMs??null,articleExecuteAvgMs:jdbc?.stages.jdbcArticle?.avgMs??null,
   droppedBusy:t.arrivals?.droppedBusyRequests??null,droppedLate:t.arrivals?.droppedLateRequests??null,
   poolPendingMax:max(probes.map(p=>p.poolPending).filter(Number.isFinite)),tomcatActiveMax:max(probes.map(p=>p.tomcatThreads?.active).filter(Number.isFinite)),
   backgroundPoolPendingMax:max(probes.map(p=>p.backgroundPool?.pending).filter(Number.isFinite)),backgroundPoolActiveMax:max(probes.map(p=>p.backgroundPool?.active).filter(Number.isFinite)),
   tomcatQueuedMax:max(probes.map(p=>p.tomcatThreads?.queued).filter(Number.isFinite)),outboxPending:t.waitSample?.outboxPending??null,
   queueReady:t.waitSample?.queueReady??null,queueUnacked:t.waitSample?.queueUnacked??null,
   gcPauseOverlapMs:sumOverlap(pauses,from,to),gcPauseStarted:max(pauses.filter(e=>e.start>=from&&e.start<to).map(e=>e.durationMs)),
   hikariParkAggregateMs:sumOverlap(pool,from,to),postgresSocketAggregateMs:sumOverlap(pgSocket,from,to),commitSocketAggregateMs:sumOverlap(commitSocket,from,to),
   httpHikariParkAggregateMs:sumOverlap(httpPool,from,to),nonHttpHikariParkAggregateMs:sumOverlap(nonHttpPool,from,to),articleBackgroundHikariParkAggregateMs:sumOverlap(articleBackgroundPool,from,to),
   httpCommitSocketAggregateMs:sumOverlap(httpCommitSocket,from,to),
   jvmCpuRatio:cpu.length?round(cpu.reduce((n,e)=>n+e.jvmUser+e.jvmSystem,0)/cpu.length):null,
   machineCpuRatio:cpu.length?round(cpu.reduce((n,e)=>n+e.machineTotal,0)/cpu.length):null,
   pgIntervalFromSecond:pg?.fromSecond??null,pgIntervalToSecond:pg?.toSecond??null,pgWalFsyncAvgMs:pg?.walFsyncAvgMs??null,
   pgCheckpointsDone:pg?.checkpointsDone??null,pgCheckpointIoWriteMs:pg?.checkpointIoWriteMs??null,pgCheckpointIoFsyncMs:pg?.checkpointIoFsyncMs??null};
  timeline.push(row);return row;
 });
 const stats=a=>({events:inWindow(a).length,aggregateMs:sumOverlap(a,start,end),maxEventMs:round(max(inWindow(a).map(e=>e.durationMs)))});
 const slow=rows.filter(t=>t.httpCompleted>0).sort((a,b)=>(b.httpP95Ms??0)-(a.httpP95Ms??0)).slice(0,8);
 result.push({label:r.config.label,scenario:r.config.scenario,client:r.config.clientLocation,seconds:r.config.durationSeconds,
   gcPause:stats(pauses),hikariPark:stats(pool),httpHikariPark:stats(httpPool),nonHttpHikariPark:stats(nonHttpPool),articleBackgroundHikariPark:stats(articleBackgroundPool),postgresSocket:stats(pgSocket),commitSocket:stats(commitSocket),httpCommitSocket:stats(httpCommitSocket),
   pgIntervalFailures:events.filter(e=>e.event==='postgres-interval'&&e.probeError).length,pgIntervalSamples:snapshots.length-2,
   jfrEvents:jfr.length,stackTruncated:jfr.filter(e=>e.stackTruncated).length,
   peaks:slow,checkpoints:r.postgres.checkpoints,intervals,fullchain:r});
}
csv(output+'-spikes.csv',timeline);csv(output+'-pg-intervals.csv',pgIntervals);
writeFileSync(output+'-spikes.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({event:'spike-export',rounds:result.length,seconds:timeline.length,output}));
