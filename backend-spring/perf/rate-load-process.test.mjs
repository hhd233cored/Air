import test from 'node:test';
import assert from 'node:assert/strict';
import {rateLoad,mixedAssignment} from './rate-load.mjs';
import {mergeProcessLoads} from './rate-load-process.mjs';

test('four coordinated phases cover one global arrival sequence and unique like assignments',async()=>{
 const seen=[];const loads=[];
 for(let worker=0;worker<4;worker++){
  let time=0;
  const load=await rateLoad({seconds:1,rate:25,concurrency:50,startAtMs:100,phaseMs:worker*10,retainLateness:true,
    now:()=>time,sleep:async ms=>{await Promise.resolve();time+=ms;},task:index=>{seen.push({index:index*4+worker,at:time});return index;}});
  loads.push(load);
 }
 const merged=mergeProcessLoads(loads);assert.equal(merged.planned,100);assert.equal(merged.started,100);assert.equal(merged.droppedLate,0);
 seen.sort((a,b)=>a.index-b.index);assert.deepEqual(seen.map(x=>x.at),Array.from({length:100},(_,i)=>100+i*10));
 const pairs=seen.map(x=>mixedAssignment(x.index,20,10));assert.equal(new Set(pairs.map(p=>p.user+':'+p.article)).size,100);
 assert.equal(merged.seconds[0].started,100);assert.equal(merged.lateness.p99Ms,0);
});

test('process merge rejects lost arrivals and combines raw lateness rather than worker percentiles',()=>{
 const load={planned:2,started:2,droppedBusy:0,droppedLate:0,maxActive:1,elapsedSeconds:1,seconds:[],latenessSamples:[1,2]};
 assert.equal(mergeProcessLoads([load,{...load,latenessSamples:[3,100]}]).lateness.p95Ms,100);
 assert.throws(()=>mergeProcessLoads([{...load,planned:3}]),/counts mismatch/);
});
