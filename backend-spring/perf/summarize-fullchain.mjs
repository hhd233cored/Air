// 全批完成吞吐与阶段统计；不从批次日志推算逐事件端到端分位数。
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const allowProbeGaps = args.includes('--allow-probe-gaps');
const allowPublisherRetries = args.includes('--allow-publisher-retries');
const prefixes = args.filter(arg=>!['--allow-probe-gaps','--allow-publisher-retries'].includes(arg));
if (!prefixes.length) throw new Error('用法: node perf/summarize-fullchain.mjs target/label [...]');
assert.equal(new Set(prefixes).size,prefixes.length,'重复的输入文件不能当作重复实验');
const read = path => readFileSync(path,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const round = value => Number(value.toFixed(3));
const sum = (rows,key) => rows.reduce((total,row)=>total+row[key],0);
const emit = value => console.log(JSON.stringify(value));
function helper(name) {
  const script = fileURLToPath(new URL(name,import.meta.url));
  return execFileSync(process.execPath,[script,...prefixes],{maxBuffer:32*1024*1024})
    .toString().trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}
const httpRows = helper('summarize-http-jdbc.mjs');
const pgRows = helper('summarize-postgres-io.mjs');
const summaries = [];
for (const prefix of prefixes) {
  const events = read(prefix+'.jsonl');
  const http = httpRows.find(row=>row.event==='http-jdbc-summary' && row.prefix===prefix);
  const postgres = pgRows.find(row=>row.prefix===prefix && row.phase==='after-drain');
  const publisher = read(prefix+'-publisher-summary.jsonl').find(row=>row.event==='publisher-summary');
  const consumer = read(prefix+'-consumer-summary.jsonl').find(row=>row.phase==='all');
  const validation = JSON.parse(readFileSync(prefix+'-validation.json','utf8'));
  const start = events.find(row=>row.event==='burst-start').atEpochMs;
  const end = events.find(row=>row.event==='burst-end').atEpochMs;
  const drained = events.find(row=>row.event==='pipeline-drained').atEpochMs;
  const publish = read(prefix+'-publisher.jsonl').filter(row=>row.startedAtEpochMs>=start && row.startedAtEpochMs<=drained);
  const consume = read(prefix+'-consumer.jsonl').flatMap(row=>row.samples)
    .filter(row=>row.startedAtEpochMs>=start && row.startedAtEpochMs<=drained);
  const expected = http.result.requests, n = http.jdbcSamples;
  const mixed = http.result.scenario==='mixed', loans = mixed ? 3 : 2;
  assert.ok(['mixed','anonymous-view'].includes(http.result.scenario),prefix+' unsupported scenario');
  assert.equal(http.result.outcomes.changed,expected);
  assert.equal(http.result.statuses[202],mixed?expected/2:expected);
  if(mixed) assert.equal(http.result.statuses[200],expected/2);
  assert.equal(http.timingSamples,expected); assert.equal(http.tomcatPreFilter.samples,expected);
  assert.equal(http.transport.samples,expected); assert.equal(http.transport.missing,0);
  assert.equal(http.transport.stages.awaitHeadersResidual.samples,expected);
  assert.ok(n>0); assert.equal(http.counts.borrowed.total,loans*n);
  assert.equal(http.counts.closed.total,loans*n); assert.equal(http.counts.sqlCalls.total,(loans+1)*n);
  assert.equal(http.counts.commitCalls.total,n);
  for(const key of ['sqlFailures','commitFailures','closeFailures','rollbackCalls']) assert.equal(http.counts[key].total,0);
  for(const key of ['confirmed','marked']) assert.equal(publisher[key],expected);
  if(allowPublisherRetries){
    // Accept only failed confirmations that were retried and eventually marked once.
    // Send/mark failures, duplicate deliveries, lost events and unresolved retries still fail.
    for(const b of publish){
      assert.equal(b.claimed,b.sent,'Retry accounting: unsent claim');
      assert.equal(b.confirmed,b.markRequested,'Retry accounting: unmarked confirmation');
      assert.equal(b.confirmed,b.marked,'Retry accounting: mark failure');
      assert.equal(b.failures,b.sent-b.confirmed,'Retry accounting: unexplained failure');
    }
    assert.equal(publisher.claimed,publisher.sent);
    assert.equal(publisher.sent,expected+publisher.failures);
  }else{
    for(const key of ['claimed','sent']) assert.equal(publisher[key],expected);
    assert.equal(publisher.failures,0);
  }
  assert.equal(consumer.applied,expected); assert.equal(consumer.received,expected);
  assert.equal(publisher.markCalls,publish.filter(b=>b.markRequested>0).length); assert.equal(publisher.markRequested,expected);
  assert.equal(consumer.commitSamples,consumer.batches); assert.equal(consumer.transactions.COMMITTED,consumer.batches);
  assert.equal(consumer.statsSqlCalls,consumer.batches); assert.equal(consumer.cacheDeleteCalls,consumer.batches);
  assert.equal(consumer.viewEvents,mixed?expected/2:expected); assert.equal(consumer.likeEvents,mixed?expected/2:0);
  for(const key of ['duplicate','rejected','requeued','cacheEvictionFailures','cacheEvictionFailedArticles']) assert.equal(consumer[key],0);
  assert.equal(sum(publish,'marked'),expected); assert.equal(sum(consume,'applied'),expected);
  assert.equal(validation.articles,http.config.articleCount); assert.equal(validation.wrongArticles,0);
  assert.equal(validation.views,mixed?expected/2:expected); assert.equal(validation.likes,mixed?expected/2:0);
  assert.equal(validation.statsViews,validation.views); assert.equal(validation.statsLikes,validation.likes);
  assert.equal(validation.outbox,expected); assert.equal(validation.processed,expected); assert.equal(validation.unpublished,0);
  const probeGaps=events.filter(row=>row.event==='wait-sample'&&(row.status!==undefined||row.queueProbeError));
  assert.equal(events.filter(row=>row.event==='wait-sample'&&row.status!==undefined).length,http.waitSummary.probeFailures);
  assert.equal(events.filter(row=>row.event==='wait-sample'&&row.queueProbeError).length,http.waitSummary.queueProbeFailures);
  if(!allowProbeGaps){assert.equal(http.waitSummary.probeFailures,0);assert.equal(http.waitSummary.queueProbeFailures,0);}
  assert.ok(http.waitSummary.samples>0,'No valid wait probes');
  assert.ok(events.some(row=>row.event==='wait-sample'&&Number.isFinite(row.queueTotal)),'No valid queue probes');
  assert.equal(postgres.database.deadlocks,0); assert.equal(postgres.statementInfo.dealloc,0);
  const queues = readFileSync(prefix+'-queues.txt','utf8').split(/\r?\n/).filter(line=>line.startsWith('airchord.'));
  assert.equal(queues.length,4); for(const line of queues) assert.match(line,/\s0\s+0$/);
  const ackSeconds = (Math.max(...consume.map(row=>row.endedAtEpochMs))-start)/1000;
  const publisherSeconds = (Math.max(...publish.map(row=>row.endedAtEpochMs))-start)/1000;
  assert.ok(ackSeconds>0);
  const publisherStages = Object.fromEntries(Object.entries(publisher.stages).map(([key,stage])=>
    [key,{...stage,avgPerBatchMs:round(stage.totalMs/publisher.batches),amortizedPerEventMs:round(stage.totalMs/expected)}]));
  const gaps=http.waitSummary.probeFailures+http.waitSummary.queueProbeFailures;
  const summary = {event:'fullchain-summary',prefix,checks:gaps?'PASS_WITH_PROBE_GAPS':publisher.failures?'PASS_WITH_PUBLISHER_RETRIES':'PASS',businessChecks:'PASS',
    delivery:{allowPublisherRetries,confirmationFailures:publisher.failures,sendAttempts:publisher.sent,confirmed:publisher.confirmed,retriesRecovered:publisher.failures>0},
    observation:{allowProbeGaps,probeFailures:http.waitSummary.probeFailures,
      queueProbeFailures:http.waitSummary.queueProbeFailures,probeGaps},config:http.config,
    sustained:events.find(row=>row.event==='sustained-load')??null,
    steady:events.find(row=>row.event==='sustained-steady-window')??null,
    preparation:events.find(row=>row.event==='comparison-ready'),http,
    operations:events.filter(row=>row.event==='comparison-operation-result'),
    pipeline:{httpSeconds:round((end-start)/1000),lastPublisherSeconds:round(publisherSeconds),
      lastConsumerAckSeconds:round(ackSeconds),batchCompletionRps:round(expected/ackSeconds),
      tailAfterHttpMs:Math.max(...consume.map(row=>row.endedAtEpochMs))-end,
      managementDrainSeconds:round((drained-start)/1000)},
    publisher:{...publisher,stages:publisherStages},consumer,postgres,
    countConverged:events.filter(row=>row.event==='count-converged'),validation};
  summaries.push(summary); emit(summary);
  const seconds = Math.floor(Math.max(ackSeconds,publisherSeconds,(end-start)/1000))+1;
  let httpCumulative=0,publishedCumulative=0,appliedCumulative=0;
  for(let second=0;second<seconds;second++) {
    const from=start+second*1000,to=from+1000;
    const completed=events.find(row=>row.event==='connection-acquire-second' && row.secondStartEpochMs===from);
    const jdbc=httpRows.find(row=>row.event==='http-jdbc-timeline' && row.prefix===prefix && row.secondStartEpochMs===from);
    const publisherEnds=publish.filter(row=>row.endedAtEpochMs>=from && row.endedAtEpochMs<to);
    const consumerEnds=consume.filter(row=>row.endedAtEpochMs>=from && row.endedAtEpochMs<to);
    const probes=events.filter(row=>row.event==='wait-sample' && row.sampledAtEpochMs>=from && row.sampledAtEpochMs<to);
    httpCumulative+=completed?.requests??0;publishedCumulative+=sum(publisherEnds,'marked');appliedCumulative+=sum(consumerEnds,'applied');
    emit({event:'fullchain-timeline',prefix,second,secondStartEpochMs:from,
      httpCompleted:completed?.requests??0,httpCumulative,
      acquireAvgMs:completed?round(completed.preAvgMs+completed.controllerAvgMs):null,
      jdbcSamples:jdbc?.requests??0,jdbcHoldAvgMs:jdbc?.stages.dbHold.avgMs??null,
      jdbcCommitAvgMs:jdbc?.stages.jdbcCommit.avgMs??null,
      published:sum(publisherEnds,'marked'),publishedCumulative,
      applied:sum(consumerEnds,'applied'),appliedCumulative,
      publisherBatches:publisherEnds.length,consumerBatches:consumerEnds.length,
      outstandingEvents:httpCumulative-appliedCumulative,
      arrivals:events.find(row=>row.event==='sustained-arrival-second'&&row.secondStartEpochMs===from)??null,
      waitSample:probes.at(-1)??null});
  }
  assert.equal(httpCumulative,expected);assert.equal(publishedCumulative,expected);assert.equal(appliedCumulative,expected);
}
const groups = new Map();
for(const row of summaries) {
  const profile = {scenario:row.http.result.scenario,imageId:row.config.imageId,poolSize:row.config.poolSize,
    publisherMaxBatches:row.config.publisherMaxBatches,consumerBatchSize:row.config.consumerBatchSize,
    clientLocation:row.config.clientLocation??'host',concurrency:row.config.concurrency,
    articleCount:row.config.articleCount,jdbcSampleRate:row.config.jdbcSampleRate,
    durationSeconds:row.config.durationSeconds??0,targetRps:row.config.targetRps??0,
    observerProcess:row.config.observerProcess??false,jvmProfile:row.config.jvmProfile??false};
  profile.loadWorkers=row.config.loadWorkers??1;profile.backgroundPoolSize=row.config.backgroundPoolSize??0;
  profile.markServerPrepareDisabled=row.config.markServerPrepareDisabled??null;
  const key = JSON.stringify(profile);
  if(!groups.has(key)) groups.set(key,{profile,rows:[]});
  groups.get(key).rows.push(row);
}
for(const {profile,rows} of groups.values()) {
  const requests=rows.reduce((total,row)=>total+row.http.result.requests,0);
  const samples=rows.reduce((total,row)=>total+row.http.jdbcSamples,0);
  const weighted = name => round(rows.reduce((total,row)=>total+row.http.stages[name].totalMs,0)/samples);
  emit({event:'fullchain-group',...profile,rounds:rows.length,requests,jdbcSamples:samples,
    httpRps:round(requests/rows.reduce((total,row)=>total+row.http.clientRuntime.seconds,0)),
    batchCompletionRps:round(requests/rows.reduce((total,row)=>total+row.pipeline.lastConsumerAckSeconds,0)),
    httpP95RangeMs:rows.map(row=>row.http.result.p95Ms),httpP99RangeMs:rows.map(row=>row.http.result.p99Ms),
    acquireAvgMs:round(rows.reduce((total,row)=>total+(row.http.acquirePre.avgMs+row.http.acquireController.avgMs)*row.http.result.requests,0)/requests),
    holdAvgMs:weighted('dbHold'),commitAvgMs:weighted('jdbcCommit'),accountExecuteAvgMs:weighted('jdbcAccount'),articleExecuteAvgMs:weighted('jdbcArticle'),
    commitSharePct:round(100*rows.reduce((total,row)=>total+row.http.stages.jdbcCommit.totalMs,0)/rows.reduce((total,row)=>total+row.http.stages.dbHold.totalMs,0)),
    awaitHeadersResidualAvgMs:round(rows.reduce((total,row)=>total+row.http.transport.stages.awaitHeadersResidual.totalMs,0)/requests)});
}
