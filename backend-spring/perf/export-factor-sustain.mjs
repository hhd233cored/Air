import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

// 输入 summarize-fullchain 的完整结果；保留逐秒缺测为空，不平均单轮分位数。
const [input,output] = process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node perf/export-factor-sustain.mjs summary.jsonl output-prefix');
const read=path=>readFileSync(path,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const raw=read(input),summaries=raw.filter(r=>r.event==='fullchain-summary');
assert.ok(summaries.length);
const round=x=>x==null?null:Number(x.toFixed(3));
const csv=(path,rows)=>{
 assert.ok(rows.length);
 const keys=Object.keys(rows[0]);
 const escape=x=>x==null?'':'"'+(typeof x==='object'?JSON.stringify(x):String(x)).replaceAll('"','""')+'"';
 writeFileSync(path,[keys.join(','),...rows.map(r=>keys.map(k=>escape(r[k])).join(','))].join('\n')+'\n');
};
const detailed=summaries.map(r=>{
 assert.ok(['PASS','PASS_WITH_PROBE_GAPS','PASS_WITH_PUBLISHER_RETRIES'].includes(r.checks));
 const lag=read(r.prefix+'-event-lag.jsonl').find(x=>x.metricType==='ALL');
 assert.equal(lag.events,r.http.result.requests);assert.equal(lag.published,lag.events);assert.equal(lag.processed,lag.events);
 assert.equal(lag.negativeApplyStartLag,0);
 if(r.publisher.failures>0){
  assert.equal(r.checks,'PASS_WITH_PUBLISHER_RETRIES');
  assert.equal(lag.totalAttempts,r.publisher.failures,'Durable retry count mismatch');
  assert.ok(lag.retried>0&&lag.retried<=lag.totalAttempts);
 }else assert.equal(lag.retried,0);
 const t=raw.filter(x=>x.event==='fullchain-timeline'&&x.prefix===r.prefix);
 const windows=[];
 if(r.sustained)for(let from=10;from<r.sustained.durationSeconds;from+=10){
  const rows=t.filter(x=>x.second>=from&&x.second<Math.min(from+10,r.sustained.durationSeconds));
  const probes=rows.map(x=>x.waitSample).filter(Boolean);
  windows.push({fromSecond:from,toSecond:Math.min(from+10,r.sustained.durationSeconds),
   completedRps:round(rows.reduce((n,x)=>n+x.httpCompleted,0)/rows.length),
   appliedRps:round(rows.reduce((n,x)=>n+x.applied,0)/rows.length),
   startedUnitRequests:rows.reduce((n,x)=>n+(x.arrivals?.startedRequests??0),0),
   outstandingStart:rows[0]?.outstandingEvents??null,outstandingEnd:rows.at(-1)?.outstandingEvents??null,
   outboxFirst:probes[0]?.outboxPending??null,outboxLast:probes.at(-1)?.outboxPending??null,
   queueFirst:probes[0]?.queueTotal??null,queueLast:probes.at(-1)?.queueTotal??null,
   probeSeconds:probes.length});
 }
 return {...r,eventLag:lag,windows};
});
writeFileSync(output+'-detail.json',JSON.stringify(detailed,null,2)+'\n');
csv(output+'-rounds.csv',detailed.map(r=>({label:r.config.label,scenario:r.http.result.scenario,
 pool:r.config.poolSize,backgroundPool:r.config.backgroundPoolSize??0,loadWorkers:r.config.loadWorkers??1,publisherBatches:r.config.publisherMaxBatches,
 concurrency:r.config.concurrency,durationSeconds:r.sustained?.durationSeconds??0,targetRps:r.sustained?.targetRps??0,
 plannedRequests:r.sustained?.plannedRequests??r.http.result.requests,
 startedRequests:r.http.result.requests,droppedBusy:r.sustained?.droppedBusyRequests??0,droppedLate:r.sustained?.droppedLateRequests??0,
 httpRps:r.http.result.rps,steadyRps:r.steady?.rps??null,batchCompletionRps:r.pipeline.batchCompletionRps,
 httpP50Ms:r.http.result.p50Ms,httpP95Ms:r.http.result.p95Ms,httpP99Ms:r.http.result.p99Ms,
 steadyP95Ms:r.steady?.p95Ms??null,steadyP99Ms:r.steady?.p99Ms??null,
 lastConsumerSeconds:r.pipeline.lastConsumerAckSeconds,tailAfterHttpMs:r.pipeline.tailAfterHttpMs,
 acquireAvgMs:round(r.http.acquirePre.avgMs+r.http.acquireController.avgMs),jdbcCommitAvgMs:r.http.stages.jdbcCommit.avgMs,
 accountExecuteAvgMs:r.http.stages.jdbcAccount.avgMs,articleExecuteAvgMs:r.http.stages.jdbcArticle.avgMs,
 maxPoolPending:r.http.waitSummary.maxPoolPending,maxOutboxPending:r.http.waitSummary.maxOutboxPending,
 maxBackgroundPending:r.http.waitSummary.maxBackgroundPending??null,
 maxQueueReady:r.http.waitSummary.maxQueueReady,maxQueueUnacked:r.http.waitSummary.maxQueueUnacked,
 publishLagP95Ms:r.eventLag.publishLagMs.p95,applyStartLagP95Ms:r.eventLag.applyStartLagMs.p95,
 applyStartLagP99Ms:r.eventLag.applyStartLagMs.p99,
 publisherClaimPerBatchMs:r.publisher.stages.claimMs.avgPerBatchMs,
 publisherSendPerBatchMs:r.publisher.stages.sendMs.avgPerBatchMs,
 publisherConfirmWaitPerBatchMs:r.publisher.stages.confirmWaitMs.avgPerBatchMs,
 publisherMarkPerBatchMs:r.publisher.stages.markMs.avgPerBatchMs,
 consumerAcquireSharePct:round(r.consumer.stages.eventAcquireMs.cycleSharePct+r.consumer.stages.applyAcquireMs.cycleSharePct),
 consumerCachePerBatchMs:r.consumer.stages.cacheMs.avgMs,
 walFsyncAvgMs:r.postgres.walFsyncAvgMs,walFsyncMs:r.postgres.walFsyncMs,
 clientElu:r.http.clientRuntime.eventLoopUtilization,clientLoopP99Ms:r.http.clientRuntime.loopDelayP99Ms,
 clientLoopP99Aggregation:r.http.clientRuntime.loopDelayP99Aggregation??'single-process',
 schedulerP99Ms:r.sustained?.lateness.p99Ms??null,views:r.validation.views,likes:r.validation.likes,
 markServerPrepareDisabled:r.config.markServerPrepareDisabled??null,publisherConfirmationFailures:r.publisher.failures,publisherSendAttempts:r.publisher.sent,probeFailures:r.http.waitSummary.probeFailures,queueProbeFailures:r.http.waitSummary.queueProbeFailures,checks:r.checks})));
csv(output+'-timeline.csv',raw.filter(r=>r.event==='fullchain-timeline').map(r=>({
 label:r.prefix.replace(/^target\//,''),second:r.second,epochMs:r.secondStartEpochMs,
 planned:r.arrivals?.plannedRequests??null,started:r.arrivals?.startedRequests??null,
 droppedBusy:r.arrivals?.droppedBusyRequests??null,droppedLate:r.arrivals?.droppedLateRequests??null,
 httpCompleted:r.httpCompleted,httpCumulative:r.httpCumulative,published:r.published,applied:r.applied,
 appliedCumulative:r.appliedCumulative,outstandingEvents:r.outstandingEvents,
 acquireAvgMs:r.acquireAvgMs,jdbcCommitAvgMs:r.jdbcCommitAvgMs,poolPending:r.waitSample?.poolPending??null,
 backgroundPoolPending:r.waitSample?.backgroundPool?.pending??null,backgroundPoolActive:r.waitSample?.backgroundPool?.active??null,
 outboxPending:r.waitSample?.outboxPending??null,queueReady:r.waitSample?.queueReady??null,
 queueUnacked:r.waitSample?.queueUnacked??null,queueTotal:r.waitSample?.queueTotal??null,
 probeEpochMs:r.waitSample?.sampledAtEpochMs??null,queueProbeEpochMs:r.waitSample?.queueSampledAtEpochMs??null,
 dbWaitEvents:r.waitSample?.dbWaitEvents??null})));
console.log(JSON.stringify({event:'export-complete',rounds:summaries.length,output}));
