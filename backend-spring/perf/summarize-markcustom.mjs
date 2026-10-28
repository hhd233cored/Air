import {readFileSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
import {summarizeMarkBatches} from './summarize-mark-jdbc.mjs';
const output=process.argv[2];if(!output)throw Error('Usage: summarize-markcustom.mjs output-prefix');
const read=p=>readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const round=n=>Number(n.toFixed(3));
const seal=JSON.parse(readFileSync('target/markcustom-snapshot-2026-09-27.json','utf8'));
const results=[],groups=[];
const csv=(path,rows)=>{const keys=Object.keys(rows[0]),cell=v=>v==null?'':'"'+(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll('"','""')+'"';writeFileSync(path,[keys.join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\n')+'\n');};
const manifest=JSON.parse(readFileSync('target/markcustom-manifest-2026-09-27.json','utf8'));assert.equal(manifest.length,5);assert.ok(manifest.every(r=>r.status==='COMPLETE'));
for(const name of ['a1','b1','b2','a2']){
 const prefix=`target/markcustom-${name}-300-2026-09-27`,chain=read(prefix+'-gates.jsonl').find(r=>r.event==='fullchain-summary');
 const diag=JSON.parse(readFileSync(prefix+'-plan-waits.json','utf8')),events=read(prefix+'.jsonl');
 const start=events.find(r=>r.event==='burst-start').atEpochMs,drained=events.find(r=>r.event==='pipeline-drained').atEpochMs;
 const raw=read(prefix+'-publisher.jsonl').filter(b=>b.startedAtEpochMs>=start&&b.startedAtEpochMs<=drained&&b.markRequested>0);
 const copy=JSON.parse(readFileSync(prefix+'-snapshot.json','utf8'));
 const disabled=name.startsWith('b');assert.equal(chain.config.markServerPrepareDisabled,disabled);assert.equal(chain.businessChecks,'PASS');assert.ok(['PASS','PASS_WITH_PUBLISHER_RETRIES'].includes(chain.checks));assert.equal(copy.hash,seal.hash);
 assert.ok(raw.every(b=>b.markJdbc.serverPrepareThreshold===(disabled?0:5)));
 assert.equal(chain.config.poolSize,20);assert.equal(chain.config.backgroundPoolSize,4);assert.equal(chain.config.loadWorkers,4);
 assert.equal(chain.config.durationSeconds,300);assert.equal(chain.config.articleOffset,1201);assert.equal(chain.config.articleCount,100);
 assert.ok(diag.planState.before.publishedNullFrac===0,'Empty-pending snapshot statistics not restored');
 const plans=diag.planRows,flat=plans.flatMap(p=>p.nodes);
 const counters={plans:plans.length,genericPending:flat.filter(n=>n['Index Name']==='article_metric_outbox_pending_idx'&&n.parameterizedFilter).length,customPending:flat.filter(n=>n['Index Name']==='article_metric_outbox_pending_idx'&&n.parameterizedFilter===false).length};
 if(disabled)assert.equal(counters.genericPending,0,'Server prepare disabled but generic filter captured');
 const m=summarizeMarkBatches(raw);
 results.push({name,prefix,start,disabled,imageId:chain.config.imageId,initialHash:copy.hash,checks:chain.checks,delivery:chain.delivery??{confirmationFailures:chain.publisher.failures,sendAttempts:chain.publisher.sent,confirmed:chain.publisher.confirmed},publisherBatches:chain.publisher.batches,requests:chain.http.result.requests,
  rps:chain.http.result.rps,httpP95Ms:chain.http.result.p95Ms,httpP99Ms:chain.http.result.p99Ms,missPct:round(100*(1-chain.http.result.requests/chain.sustained.plannedRequests)),steady:chain.steady,
  mark:m,first90:summarizeMarkBatches(raw.filter(b=>b.markStartedAtEpochMs<start+90000)),
  plans:counters,planState:diag.planState,wait:diag.waitSampling,linux:diag.linux,slowCommit:diag.slowCommit.slice(0,3),
  publisher:chain.publisher.stages,consumer:chain.consumer.stages,queue:chain.http.waitSummary,pipeline:chain.pipeline,postgres:chain.postgres,
  eventLag:read(prefix+'-event-lag.jsonl').find(r=>r.metricType==='ALL'),raw});
}
assert.equal(new Set(results.map(r=>r.imageId)).size,1,'Different application artifacts');
for(const disabled of [false,true]){
 const rounds=results.filter(r=>r.disabled===disabled),raw=rounds.flatMap(r=>r.raw),m=summarizeMarkBatches(raw);
 const publisher=Object.fromEntries(['claimMs','sendMs','confirmWaitMs','markMs'].map(k=>[k,round(rounds.reduce((n,r)=>n+r.publisher[k].totalMs,0)/rounds.reduce((n,r)=>n+r.publisherBatches,0))]));
 groups.push({disabled,rounds:rounds.map(r=>r.name),requests:rounds.reduce((n,r)=>n+r.requests,0),mark:m,first90:summarizeMarkBatches(rounds.flatMap(r=>r.raw.filter(b=>b.markStartedAtEpochMs<r.start+90000))),publisher,
  confirmationFailures:rounds.reduce((n,r)=>n+r.delivery.confirmationFailures,0),httpRps:round(rounds.reduce((n,r)=>n+r.requests,0)/rounds.reduce((n,r)=>n+r.pipeline.httpSeconds,0)),batchCompletionRps:round(rounds.reduce((n,r)=>n+r.requests,0)/rounds.reduce((n,r)=>n+r.pipeline.lastConsumerAckSeconds,0)),maxQueueReady:Math.max(...rounds.map(r=>r.queue.maxQueueReady)),maxOutbox:Math.max(...rounds.map(r=>r.queue.maxOutboxPending)),httpP95ByRound:rounds.map(r=>r.httpP95Ms),tailMsByRound:rounds.map(r=>r.pipeline.tailAfterHttpMs)});
}
const published=results.map(({raw,...r})=>r);
writeFileSync(output+'-comparison.json',JSON.stringify({checks:'PASS',snapshot:seal,groups,rounds:published},null,2)+'\n');
csv(output+'-comparison.csv',results.map(r=>({name:r.name,disabled:r.disabled,checks:r.checks,confirmationFailures:r.delivery.confirmationFailures,requests:r.requests,rps:r.rps,httpP95Ms:r.httpP95Ms,httpP99Ms:r.httpP99Ms,missPct:r.missPct,markBatches:r.mark.batches,fullBatches:r.mark.fullBatches,sqlAvgMs:r.mark.stages.executeMs.avgMs,sqlP95Ms:r.mark.stages.executeMs.p95Ms,sqlP99Ms:r.mark.stages.executeMs.p99Ms,commitAvgMs:r.mark.stages.commitMs.avgMs,commitP99Ms:r.mark.stages.commitMs.p99Ms,markAvgMs:r.mark.stages.markMs.avgMs,outboxPeak:r.queue.maxOutboxPending,queueReadyPeak:r.queue.maxQueueReady,tailMs:r.pipeline.tailAfterHttpMs,genericPendingPlans:r.plans.genericPending})));
console.log(JSON.stringify({checks:'PASS',groups,rounds:published.map(r=>({name:r.name,rps:r.rps,httpP95Ms:r.httpP95Ms,sql:r.mark.stages.executeMs,commit:r.mark.stages.commitMs,plans:r.plans,outboxPeak:r.queue.maxOutboxPending,tail:r.pipeline.tailAfterHttpMs}))}));

