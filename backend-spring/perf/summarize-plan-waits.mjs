import {createReadStream,readFileSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
import {analyzeMark} from './summarize-mark-jdbc.mjs';
const [prefix,output]=process.argv.slice(2);
if(!output)throw Error('Usage: summarize-plan-waits.mjs target/label output-prefix');
const read=p=>readFileSync(p,'utf8').trim().split(/\r?\n/).filter(line=>line.startsWith('{')).map(JSON.parse);
const round=n=>Number(n.toFixed(3));
const stats=a=>{a=a.slice().sort((a,b)=>a-b);return {samples:a.length,avg:a.length?round(a.reduce((s,n)=>s+n,0)/a.length):null,p50:a.length?a[Math.ceil(a.length*.5)-1]:null,p95:a.length?a[Math.ceil(a.length*.95)-1]:null,p99:a.length?a[Math.ceil(a.length*.99)-1]:null,max:a.length?a.at(-1):null};};
const duration=s=>{const m=/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(s);assert.ok(m);return(+m[1]||0)*3600000+(+m[2]||0)*60000+(+m[3]||0)*1000;};
const csv=(path,rows)=>{assert.ok(rows.length);const keys=Object.keys(rows[0]);const cell=v=>v==null?'':'"'+(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll('"','""')+'"';writeFileSync(path,[keys.join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\n')+'\n');};
const events=read(prefix+'.jsonl'),start=events.find(e=>e.event==='burst-start').atEpochMs,end=events.find(e=>e.event==='burst-end').atEpochMs;
const drained=events.find(e=>e.event==='pipeline-drained').atEpochMs;
const mark=analyzeMark(prefix),batches=mark.batchRows;
assert.ok(batches.every(b=>b.backendPid>0),'Missing backend PID');
for(const b of batches){b.executeWaitSamples={};b.commitWaitSamples={};b.commitObservedStates={};b.plans=[];}
const plans=read(prefix+'-plans.jsonl').filter(p=>p.atEpochMs>=start&&p.atEpochMs<=drained);
const flatten=n=>[n,...(n.Plans??[]).flatMap(flatten)];
let unmatchedPlans=0;
for(const p of plans){
 const matches=batches.filter(b=>b.backendPid===p.pid&&p.atEpochMs>=b.executeStartedAtEpochMs-3&&p.atEpochMs<=b.executeEndedAtEpochMs+3);
 if(matches.length!==1){unmatchedPlans++;continue;}
 const b=matches[0];assert.ok(p.durationMs<=b.executeMs+3,'Server execution exceeds JDBC duration');
 b.plans.push(p);
}
const byPid=new Map();for(const b of batches){if(!byPid.has(b.backendPid))byPid.set(b.backendPid,[]);byPid.get(b.backendPid).push(b);}
let waitSamples=0,firstWait=null,lastWait=null,prior=null;const gaps=[];
for await(const line of createInterface({input:createReadStream(prefix+'-pg-waits.log'),crlfDelay:Infinity})){
 if(!line.startsWith('{'))continue;const row=JSON.parse(line),t=row.atEpochMs;
 firstWait??=t;lastWait=t;if(t<start||t>drained)continue;
 waitSamples++;if(prior!==null)gaps.push(t-prior);prior=t;
 for(const backend of row.backends){
  const list=byPid.get(backend.pid);if(!list)continue;
  // Publisher batches are sequential. Binary search the last call begun before sample.
  let lo=0,hi=list.length;while(lo<hi){const mid=(lo+hi)>>1;if(list[mid].markStartedAtEpochMs<=t)lo=mid+1;else hi=mid;}
  const b=list[lo-1];if(!b||t>b.markEndedAtEpochMs)continue;
  const phase=t>=b.commitStartedAtEpochMs&&t<=b.commitEndedAtEpochMs?'commit':t>=b.executeStartedAtEpochMs&&t<=b.executeEndedAtEpochMs?'execute':null;
  if(!phase)continue;
  if(phase==='commit'){
   const state=backend.state+'/'+backend.kind;b.commitObservedStates[state]=(b.commitObservedStates[state]??0)+1;
  }
  // Idle ClientRead is not a database commit wait. Query timestamps reject stale activity.
  if(backend.state!=='active'||backend.kind!==(phase==='commit'?'commit':'mark'))continue;
  const phaseStart=phase==='commit'?b.commitStartedAtEpochMs:b.executeStartedAtEpochMs;
  if(backend.queryStartMs<phaseStart-3||backend.queryStartMs>t+3)continue;
  const key=backend.waitType?backend.waitType+'/'+backend.waitEvent:'active/no-wait';
  const target=b[phase+'WaitSamples'];target[key]=(target[key]??0)+1;
 }
}
assert.ok(firstWait<=start&&lastWait>=drained,'Wait observer does not cover drain');assert.ok(waitSamples>0);
let linuxRow=null;const linux=[];
for await(const line of createInterface({input:createReadStream(prefix+'-linux.log'),crlfDelay:Infinity})){
 if(line.startsWith('time ')){if(linuxRow)linux.push(linuxRow);linuxRow={atEpochMs:+line.slice(5),psi:{},disks:{}};continue;}
 if(!linuxRow)continue;
 if(line.startsWith('cpu '))linuxRow.cpu=line.trim().split(/\s+/).slice(1).map(Number);
 else if(line.startsWith('psi-')){const m=/^psi-(\w+) (some|full).*total=(\d+)/.exec(line);if(m)linuxRow.psi[m[1]+'/'+m[2]]=+m[3];}
 else if(line.startsWith('disk ')){const a=line.trim().split(/\s+/);if(!a[3].startsWith('ram')&&!a[3].startsWith('loop'))linuxRow.disks[a[3]]=a.slice(4).map(Number);}
 else if(line.startsWith('cg-cpu usage_usec '))linuxRow.pgCpuUsec=+line.split(' ').at(-1);
 else if(line.startsWith('cg-cpu throttled_usec '))linuxRow.pgThrottledUsec=+line.split(' ').at(-1);
 else if(line.startsWith('cg-memory '))linuxRow.pgMemoryBytes=+line.split(' ').at(-1);
 else if(line.startsWith('MemAvailable:'))linuxRow.vmAvailableBytes=+line.trim().split(/\s+/)[1]*1024;
}
if(linuxRow?.cpu)linux.push(linuxRow);
assert.ok(linux[0].atEpochMs<=start&&linux.at(-1).atEpochMs>=end,'Linux observer does not cover burst');
const linuxIntervals=[];
for(let i=1;i<linux.length;i++){
 const a=linux[i-1],b=linux[i],ms=b.atEpochMs-a.atEpochMs;if(!a.cpu||!b.cpu||ms<=0)continue;
 const delta=b.cpu.map((n,j)=>n-a.cpu[j]),total=delta.slice(0,8).reduce((s,n)=>s+n,0);
 const psi=Object.fromEntries(Object.keys(b.psi).map(k=>[k,round((b.psi[k]-a.psi[k])/ms/10)]));
 const disks=Object.fromEntries(Object.entries(b.disks).filter(([k])=>a.disks[k]).map(([k,d])=>{
  const p=a.disks[k],reads=d[0]-p[0],writes=d[4]-p[4];return [k,{reads,writes,ioMs:d[9]-p[9],weightedIoMs:d[10]-p[10],readWriteAvgMs:reads+writes?round((d[3]-p[3]+d[7]-p[7])/(reads+writes)):null}];
 }));
 linuxIntervals.push({from:a.atEpochMs,to:b.atEpochMs,second:round((b.atEpochMs-start)/1000),ms,cpuBusyPct:round(100*(total-delta[3]-delta[4])/total),cpuIoWaitPct:round(100*delta[4]/total),psiPct:psi,pgCpuCores:round((b.pgCpuUsec-a.pgCpuUsec)/ms/1000),pgThrottledMs:round((b.pgThrottledUsec-a.pgThrottledUsec)/1000),pgMemoryBytes:b.pgMemoryBytes,vmAvailableBytes:b.vmAvailableBytes,disks});
}
const inBurst=linuxIntervals.filter(r=>r.from>=start&&r.to<=end);
const host=read(prefix+'-host.jsonl').filter(r=>r.atEpochMs>=start&&r.atEpochMs<=end);
const longCommits=batches.filter(b=>b.commitMs>=80),jfrCommits=[],gc=[];
for await(const line of createInterface({input:createReadStream(prefix+'-jfr-events.jsonl'),crlfDelay:Infinity})){
 const e=JSON.parse(line),from=Date.parse(e.startTime),ms=duration(e.duration);
 if(e.type==='jdk.GCPhasePause'){gc.push({from,to:from+ms,ms});continue;}
 if(e.type!=='jdk.SocketRead'||e.role!=='commitSocket'||!e.stack.some(s=>s.includes('ArticleMetricPublisherMarkJdbc')))continue;
 if(from<start-1000||from>drained+1000)continue;
 jfrCommits.push({from,to:from+ms,ms,thread:e.thread,stackTruncated:e.stackTruncated});
}
for(const b of longCommits){
 const candidates=jfrCommits.filter(e=>Math.abs(e.ms-b.commitMs)<2&&Math.abs(e.to-b.commitEndedAtEpochMs)<150).sort((a,c)=>Math.abs(a.to-b.commitEndedAtEpochMs)-Math.abs(c.to-b.commitEndedAtEpochMs));
 if(!candidates.length)continue;const e=candidates[0],offset=b.commitEndedAtEpochMs-e.to;
 b.jfr={socketMs:round(e.ms),socketSharePct:round(e.ms/b.commitMs*100),thread:e.thread,epochOffsetMs:round(offset),
  gcOverlapAfterLocalAlignmentMs:round(gc.reduce((n,g)=>n+Math.max(0,Math.min(b.commitEndedAtEpochMs,g.to+offset)-Math.max(b.commitStartedAtEpochMs,g.from+offset)),0))};
}
const aggregate=key=>{const total={};for(const b of batches)for(const [event,n]of Object.entries(b[key]))total[event]=(total[event]??0)+n;return total;};
const planRows=plans.map(p=>({second:round((p.atEpochMs-start)/1000),pid:p.pid,serverMs:p.durationMs,shape:flatten(p.plan).map(n=>n['Node Type']+(n['Index Name']?'('+n['Index Name']+')':'')).join(' > '),nodes:flatten(p.plan)}));
const shapes={};for(const p of planRows)shapes[p.shape]=(shapes[p.shape]??0)+1;
const detail=b=>{const mid=(b.commitStartedAtEpochMs+b.commitEndedAtEpochMs)/2,li=linuxIntervals.find(r=>r.from<=mid&&r.to>mid);return {...b,linux:li??null};};
const report={prefix,start,end,drained,checks:'PASS',config:JSON.parse(readFileSync(prefix+'-config.json','utf8')),http:events.find(e=>e.event==='comparison-result'),sustained:events.find(e=>e.event==='sustained-load'),waitSummary:events.find(e=>e.event==='wait-summary'),validation:JSON.parse(readFileSync(prefix+'-validation.json','utf8')),mark:mark.summary,windows:mark.windows,
 planCapture:{thresholdMs:20,plans:planRows.length,matched:plans.length-unmatchedPlans,unmatched:unmatchedPlans,shapes,serverMs:stats(plans.map(p=>p.durationMs))},planRows,
 waitSampling:{samples:waitSamples,gapMs:stats(gaps),firstWait,lastWait,execute:aggregate('executeWaitSamples'),commit:aggregate('commitWaitSamples'),commitStates:aggregate('commitObservedStates')},
 linux:{samples:inBurst.length,gapMs:stats(inBurst.map(r=>r.ms)),cpuBusyPct:stats(inBurst.map(r=>r.cpuBusyPct)),cpuIoWaitPct:stats(inBurst.map(r=>r.cpuIoWaitPct)),ioSomePct:stats(inBurst.map(r=>r.psiPct['io/some'])),cpuSomePct:stats(inBurst.map(r=>r.psiPct['cpu/some'])),memorySomePct:stats(inBurst.map(r=>r.psiPct['memory/some'])),pgCpuCores:stats(inBurst.map(r=>r.pgCpuCores)),pgThrottleMs:inBurst.reduce((s,r)=>s+r.pgThrottledMs,0),minVmAvailableBytes:Math.min(...inBurst.map(r=>r.vmAvailableBytes)),maxPgMemoryBytes:Math.max(...inBurst.map(r=>r.pgMemoryBytes)),wslHostSamples:host.length,wslMaxWorkingSetBytes:Math.max(...host.map(r=>r.workingSetBytes)),hostCpuAvailable:host.some(r=>Number.isFinite(r.cpuSeconds))},
 slowSql:batches.slice().sort((a,b)=>b.executeMs-a.executeMs).slice(0,10).map(detail),slowCommit:batches.slice().sort((a,b)=>b.commitMs-a.commitMs).slice(0,10).map(detail),longCommitCount:longCommits.length,jfrMatchedLongCommits:longCommits.filter(b=>b.jfr).length,
 planState:{before:read(prefix+'-plan-before.jsonl').at(-1),after:read(prefix+'-plan-after.jsonl').at(-1)}};
writeFileSync(output+'.json',JSON.stringify(report,null,2)+'\n');
csv(output+'-batches.csv',batches);
if(planRows.length)csv(output+'-plans.csv',planRows);else writeFileSync(output+'-plans.csv','second,pid,serverMs,shape,nodes\n');
csv(output+'-linux.csv',inBurst);
console.log(JSON.stringify({...report,planRows:undefined,windows:undefined,slowSql:report.slowSql.slice(0,3),slowCommit:report.slowCommit.slice(0,3)}));
