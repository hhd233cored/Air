import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {startProcessObserver,validateObserver} from './metric-observer-process.mjs';

test('observer rejects external endpoints',()=>{
 assert.throws(()=>validateObserver({base:'https://example.com',rabbitManagement:'http://localhost:18083'}));
 assert.throws(()=>validateObserver({base:'http://localhost:18081',rabbitManagement:'http://example.com:15672'}));
 validateObserver({base:'http://app:8081',rabbitManagement:'http://rabbitmq:15672',containerStack:true});
});
test('separate observer keeps failures, samples postgres and drains fresh queue samples',async()=>{
 let queueCalls=0;const rows=[];
 const server=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url.startsWith('/api/queues/')){
   queueCalls++;if(queueCalls===1){res.writeHead(503);res.end('{}');return;}
   res.end(JSON.stringify({messages_ready:0,messages_unacknowledged:0,messages:0}));
  }else if(req.url.endsWith('postgres'))res.end(JSON.stringify({startedAtEpochMs:Date.now(),endedAtEpochMs:Date.now(),wal:{wal_bytes:1}}));
  else res.end(JSON.stringify({sampledAtEpochMs:Date.now(),poolPending:0,poolActive:1,outboxPending:0,dbWaitEvents:''}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 let observer;
 try{
  observer=await startProcessObserver({base,rabbitManagement:base,rabbitPassword:'test',cookie:'test',scenario:'test',postgresCounters:true},r=>rows.push(r));
  const start=Date.now();await observer.waitForDrain(start);await observer.stop();observer=null;
  const processRow=rows.find(r=>r.event==='observer-process');assert.notEqual(processRow.pid,process.pid);
  const summary=rows.find(r=>r.event==='wait-summary');assert.ok(summary.samples>=3);assert.equal(summary.queueProbeFailures,1);
  assert.ok(rows.some(r=>r.event==='postgres-interval'));assert.ok(rows.find(r=>r.event==='pipeline-drained').atEpochMs>=start);
  assert.ok(!JSON.stringify(rows).includes('rabbitPassword'));assert.ok(rows.some(r=>r.queueProbeError));
 }finally{if(observer)await observer.stop();await new Promise(resolve=>server.close(resolve));}
});
