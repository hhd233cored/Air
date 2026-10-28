import test from 'node:test';
import assert from 'node:assert/strict';
import {rateLoad,mixedAssignment} from './rate-load.mjs';

test('paced tasks preserve unique slots and account for all arrivals',async()=>{
  const r=await rateLoad({seconds:.2,rate:100,concurrency:4,task:async index=>index});
  assert.equal(r.planned,20);assert.equal(r.started+r.droppedBusy+r.droppedLate,20);
  assert.equal(new Set(r.results.map(row=>row.index)).size,r.started);
  assert.equal(r.seconds.reduce((n,row)=>n+row.planned,0),r.planned);
  assert.equal(r.seconds.reduce((n,row)=>n+row.started,0),r.started);
  assert.equal(r.seconds.reduce((n,row)=>n+row.droppedBusy+row.droppedLate,0),r.droppedBusy+r.droppedLate);
  assert.ok(r.elapsedSeconds>=.195);assert.ok(r.maxActive<=4);
});
test('slow tasks are bounded and skipped arrivals are explicit',async()=>{
  const r=await rateLoad({seconds:.12,rate:200,concurrency:1,
    task:async()=>{await new Promise(resolve=>setTimeout(resolve,40));return 'changed';}});
  assert.equal(r.started+r.droppedBusy+r.droppedLate,r.planned);assert.ok(r.droppedBusy>0);
  assert.equal(r.maxActive,1);
});
test('scheduler stalls skip expired slots without unbounded catch-up',async()=>{
  let time=0;
  const r=await rateLoad({seconds:1,rate:10,concurrency:2,maxLatenessMs:10,
    now:()=>time,sleep:async ms=>{time+=ms+200;},task:async i=>i});
  assert.ok(r.droppedLate>0);assert.equal(r.started+r.droppedBusy+r.droppedLate,10);
});
test('mixed cycles never repeat a user/article combination',()=>{
  const seen=new Set(),perArticle=Array(7).fill(0);
  for(let i=0;i<35;i++){
    const p=mixedAssignment(i,5,7),key=p.user+':'+p.article;
    assert.ok(!seen.has(key));seen.add(key);perArticle[p.article]++;
  }
  assert.deepEqual(perArticle,Array(7).fill(5));assert.throws(()=>mixedAssignment(35,5,7));
});
test('task failures remain failures',async()=>{
  await assert.rejects(rateLoad({seconds:.02,rate:50,concurrency:1,task:async()=>{throw Error('failed');}}),/failed/);
});
