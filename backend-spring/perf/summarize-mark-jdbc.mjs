import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const read=p=>readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const round=x=>Number(x.toFixed(3));
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?round(sorted[Math.ceil(sorted.length*p)-1]):null;};
export function summarizeMarkBatches(batches){
 const counts={};
 for(const b of batches){
  assert.equal(b.markCalls,1,'Expected one batch mark call');
  const j=b.markJdbc;assert.equal(j?.instrumented,true,'Missing mark JDBC coverage');
  for(const key of ['borrowed','closed','prepareCalls','executeCalls','commitCalls'])assert.equal(j[key],1,'Mark '+key);
  for(const key of ['prepareFailures','executeFailures','commitFailures','rollbackCalls','rollbackFailures','closeFailures'])assert.equal(j[key],0,'Mark '+key);
  assert.equal(j.updatedRows,b.marked);assert.equal(b.marked,b.markRequested);
  assert.ok(b.markRequested>0);assert.ok(j.executeMs>=0&&j.commitMs>=0);
  assert.ok(j.executeMs+j.commitMs<=j.holdMs+.02,'JDBC stage times exceed lease');
  assert.ok(j.holdMs+b.markAcquireMs<=b.markMs+.1,'Lease/acquire exceed mark call');
  assert.ok(b.markStartedAtEpochMs<=j.executeStartedAtEpochMs&&j.executeStartedAtEpochMs<=j.executeEndedAtEpochMs);
  assert.ok(j.executeEndedAtEpochMs<=j.commitStartedAtEpochMs&&j.commitStartedAtEpochMs<=j.commitEndedAtEpochMs&&j.commitEndedAtEpochMs<=b.markEndedAtEpochMs);
  for(const key of ['borrowed','closed','prepareCalls','executeCalls','updatedRows','commitCalls','rollbackCalls','prepareFailures','executeFailures','commitFailures','rollbackFailures','closeFailures'])counts[key]=(counts[key]??0)+j[key];
 }
 const values=b=>({markMs:b.markMs,acquireMs:b.markAcquireMs,...Object.fromEntries(['holdMs','prepareMs','executeMs','commitMs','closeMs','otherHoldMs'].map(k=>[k,b.markJdbc[k]])),outsideLeaseMs:Math.max(0,b.markMs-b.markAcquireMs-b.markJdbc.holdMs)});
 const stats=rows=>Object.fromEntries(['markMs','acquireMs','holdMs','prepareMs','executeMs','commitMs','closeMs','otherHoldMs','outsideLeaseMs'].map(key=>{
  const a=rows.map(b=>values(b)[key]),total=a.reduce((n,v)=>n+v,0);
  return [key,{samples:a.length,totalMs:round(total),avgMs:a.length?round(total/a.length):null,p50Ms:percentile(a,.5),p95Ms:percentile(a,.95),p99Ms:percentile(a,.99),maxMs:a.length?Math.max(...a):null}];
 }));
 return {checks:'PASS',batches:batches.length,fullBatches:batches.filter(b=>b.markRequested===200).length,counts,stages:stats(batches),fullBatch:stats(batches.filter(b=>b.markRequested===200))};
}
export function analyzeMark(prefix){
 const events=read(prefix+'.jsonl'),start=events.find(e=>e.event==='burst-start').atEpochMs,end=events.find(e=>e.event==='burst-end').atEpochMs,drained=events.find(e=>e.event==='pipeline-drained').atEpochMs;
 const expected=events.find(e=>e.event==='comparison-result').requests;
 const batches=read(prefix+'-publisher.jsonl').filter(b=>b.startedAtEpochMs>=start&&b.startedAtEpochMs<=drained&&b.markRequested>0).sort((a,b)=>a.markStartedAtEpochMs-b.markStartedAtEpochMs);
 const summary={event:'mark-jdbc-summary',prefix,...summarizeMarkBatches(batches)};
 assert.equal(summary.counts.updatedRows,expected,'Mark rows do not cover HTTP writes');
 const windows=[];
 for(let from=0;from<Math.ceil((end-start)/1000);from+=10){
  const to=Math.min(from+10,Math.ceil((end-start)/1000)),rows=batches.filter(b=>b.markStartedAtEpochMs>=start+from*1000&&b.markStartedAtEpochMs<start+to*1000);
  const probes=events.filter(e=>e.event==='wait-sample'&&e.sampledAtEpochMs>=start+from*1000&&e.sampledAtEpochMs<start+to*1000);
  windows.push({event:'mark-jdbc-window',prefix,fromSecond:from,toSecond:to,...summarizeMarkBatches(rows),outboxMax:probes.length?Math.max(...probes.map(p=>p.outboxPending??0)):null,backgroundPendingMax:probes.length?Math.max(...probes.map(p=>p.backgroundPool?.pending??0)):null});
 }
 const batchRows=batches.map(b=>({second:round((b.markStartedAtEpochMs-start)/1000),markStartedAtEpochMs:b.markStartedAtEpochMs,markEndedAtEpochMs:b.markEndedAtEpochMs,rows:b.marked,markMs:b.markMs,acquireMs:b.markAcquireMs,...b.markJdbc}));
 return {summary,windows,batchRows};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const prefixes=process.argv.slice(2);assert.ok(prefixes.length,'Usage: node perf/summarize-mark-jdbc.mjs target/label [...]');
 for(const prefix of prefixes){
  const r=analyzeMark(prefix);writeFileSync(prefix+'-mark-jdbc.json',JSON.stringify(r,null,2)+'\n');
  const keys=Object.keys(r.batchRows[0]),escape=v=>v==null?'':'"'+String(v).replaceAll('"','""')+'"';
  writeFileSync(prefix+'-mark-jdbc.csv',[keys.join(','),...r.batchRows.map(row=>keys.map(k=>escape(row[k])).join(','))].join('\n')+'\n');
  console.log(JSON.stringify(r.summary));for(const window of r.windows)console.log(JSON.stringify(window));
 }
}
