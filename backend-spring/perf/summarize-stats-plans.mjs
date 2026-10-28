import {createReadStream,readFileSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
const [output,...names]=process.argv.slice(2);assert.ok(output&&names.length);
const read=p=>readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const flat=n=>[n,...(n.Plans??[]).flatMap(flat)];
const round=x=>Number(x.toFixed(3));
const stats=a=>{a=[...a].sort((a,b)=>a-b);return {samples:a.length,avg:a.length?round(a.reduce((n,v)=>n+v,0)/a.length):null,p50:a.length?a[Math.ceil(a.length*.5)-1]:null,p95:a.length?a[Math.ceil(a.length*.95)-1]:null,max:a.length?a.at(-1):null};};
const rounds=[],plans=[];
for(const name of names){
 const prefix=`target/markcustom-${name}-300-2026-09-27`,events=read(prefix+'.jsonl');
 const start=events.find(e=>e.event==='burst-start').atEpochMs,drained=events.find(e=>e.event==='pipeline-drained').atEpochMs;
 const consumers=read(prefix+'-consumer.jsonl').flatMap(r=>r.samples).filter(s=>s.startedAtEpochMs>=start&&s.startedAtEpochMs<=drained).sort((a,b)=>a.startedAtEpochMs-b.startedAtEpochMs);
 const rows=read(`target/statsplan-${name}-plans-2026-09-27.jsonl`).filter(p=>p.atEpochMs>=start&&p.atEpochMs<=drained).sort((a,b)=>a.atEpochMs-b.atEpochMs);
 let i=0;const byPid=new Map();
 for(const p of rows){
  while(consumers[i]?.endedAtEpochMs<p.atEpochMs-3)i++;
  const c=consumers[i];assert.ok(c&&p.atEpochMs>=c.startedAtEpochMs&&p.atEpochMs<=c.endedAtEpochMs+3,'Plan outside consumer batch');
  assert.equal(c.statsSqlCalls,1);assert.ok(p.durationMs<=c.statsSqlMs+3,'Server exceeds client stats SQL');
  assert.equal((p.plan['Conflicting Tuples']??0)+(p.plan['Tuples Inserted']??0),c.cacheArticles);
  const nodes=flat(p.plan),likes=nodes.filter(n=>n['Relation Name']==='article_likes');
  const lookup=nodes.filter(n=>n['Node Type']==='CTE Scan'&&n['Parent Relationship']==='SubPlan'&&n['CTE Name']==='incoming');
  p.round=name;p.second=round((p.atEpochMs-start)/1000);p.consumerStatsMs=c.statsSqlMs;p.articles=c.cacheArticles;p.likeEvents=c.likeEvents;
  p.likeRows=round(likes.reduce((n,s)=>n+(s['Actual Rows']??0)*(s['Actual Loops']??0),0));
  p.likeLoops=likes.reduce((n,s)=>n+(s['Actual Loops']??0),0);p.heapFetches=likes.reduce((n,s)=>n+(s['Heap Fetches']??0),0);
  p.likeHits=likes.reduce((n,s)=>n+(s['Shared Hit Blocks']??0),0);p.likeReads=likes.reduce((n,s)=>n+(s['Shared Read Blocks']??0),0);
  p.rootHits=p.plan['Shared Hit Blocks']??0;p.rootReads=p.plan['Shared Read Blocks']??0;
  p.lookupRows=lookup.reduce((n,s)=>n+((s['Actual Rows']??0)+(s['Rows Removed by Filter']??0))*(s['Actual Loops']??0),0);
  p.activeWaitSamples={};p.rejectedQueryStartSamples=0;
  if(!byPid.has(p.pid))byPid.set(p.pid,{rows:[],cursor:0});byPid.get(p.pid).rows.push(p);
 }
 // Existing observer classifies stats as "other". Match only captured PG execution span,
 // same PID, active state and near-start query timestamp; no idle/old-query attribution.
 for await(const line of createInterface({input:createReadStream(prefix+'-pg-waits.log'),crlfDelay:Infinity})){
  if(!line.startsWith('{'))continue;const sample=JSON.parse(line),t=sample.atEpochMs;
  for(const b of sample.backends){const slot=byPid.get(b.pid);if(!slot)continue;
   while(slot.cursor<slot.rows.length&&slot.rows[slot.cursor].atEpochMs<t)slot.cursor++;
   const p=slot.rows[slot.cursor];if(!p||t<p.atEpochMs-p.durationMs||b.state!=='active'||!['other','stats'].includes(b.kind))continue;
   if(Math.abs(b.queryStartMs-(p.atEpochMs-p.durationMs))>5){p.rejectedQueryStartSamples++;continue;}
   const key=b.waitType?b.waitType+'/'+b.waitEvent:'active/no-wait';p.activeWaitSamples[key]=(p.activeWaitSamples[key]??0)+1;
  }
 }
 const sum=k=>rows.reduce((n,r)=>n+r[k],0),wait={};for(const p of rows)for(const[k,n]of Object.entries(p.activeWaitSamples))wait[k]=(wait[k]??0)+n;
 rounds.push({name,checks:'PASS',consumerBatches:consumers.length,capturedSlowPlans:rows.length,planThresholdMs:20,serverMs:stats(rows.map(p=>p.durationMs)),consumerStatsMs:stats(consumers.map(c=>c.statsSqlMs)),likeRows:sum('likeRows'),heapFetches:sum('heapFetches'),likeHits:sum('likeHits'),rootHits:sum('rootHits'),likeHitSharePct:round(100*sum('likeHits')/sum('rootHits')),likeReads:sum('likeReads'),rootReads:sum('rootReads'),lookupRows:sum('lookupRows'),wait,rejectedQueryStartSamples:sum('rejectedQueryStartSamples'),slowest:rows.slice().sort((a,b)=>b.durationMs-a.durationMs).slice(0,3)});
 plans.push(...rows);
}
writeFileSync(output+'.json',JSON.stringify({checks:'PASS',totalSlowPlans:plans.length,sourcePlans:names.map(name=>`target/statsplan-${name}-plans-2026-09-27.jsonl`),rounds},null,2)+'\n');
const csvRows=plans.map(({plan,activeWaitSamples,...p})=>({...p,activeWaitSamples})),keys=Object.keys(csvRows[0]);
const cell=v=>v==null?'':'"'+(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll('"','""')+'"';
writeFileSync(output+'.csv',[keys.join(','),...csvRows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\n')+'\n');
console.log(JSON.stringify({checks:'PASS',rounds:rounds.map(({slowest,...r})=>r)}));
