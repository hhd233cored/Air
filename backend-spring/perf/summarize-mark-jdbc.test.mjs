import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeMarkBatches} from './summarize-mark-jdbc.mjs';
const batch=(sql,commit)=>({markCalls:1,marked:200,markRequested:200,markMs:sql+commit+2,markAcquireMs:1,markStartedAtEpochMs:10,markEndedAtEpochMs:100,
 markJdbc:{instrumented:true,borrowed:1,closed:1,prepareCalls:1,executeCalls:1,updatedRows:200,commitCalls:1,rollbackCalls:0,prepareFailures:0,executeFailures:0,commitFailures:0,rollbackFailures:0,closeFailures:0,holdMs:sql+commit+1,prepareMs:.1,executeMs:sql,commitMs:commit,closeMs:.1,otherHoldMs:.8,executeStartedAtEpochMs:11,executeEndedAtEpochMs:50,commitStartedAtEpochMs:51,commitEndedAtEpochMs:90}});
test('SQL and commit distributions use individual mark samples with exact coverage',()=>{
 const r=summarizeMarkBatches([batch(80,8),batch(4,12)]);
 assert.equal(r.counts.updatedRows,400);assert.equal(r.counts.commitCalls,2);
 assert.equal(r.stages.executeMs.avgMs,42);assert.equal(r.stages.executeMs.p95Ms,80);
 assert.equal(r.stages.commitMs.avgMs,10);assert.equal(r.stages.commitMs.p95Ms,12);
});
test('missing coverage, leaked lease, lost rows and failed commit reject results',()=>{
 for(const [key,value] of [['instrumented',false],['closed',0],['updatedRows',199],['commitFailures',1]]){
  const b=batch(80,8);b.markJdbc[key]=value;assert.throws(()=>summarizeMarkBatches([b]));
 }
});
