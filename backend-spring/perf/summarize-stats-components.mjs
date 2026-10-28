import {readFileSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
import {sanitizeNode} from './parse-auto-explain.mjs';
const [input,output]=process.argv.slice(2);assert.ok(input&&output);
const readDocuments=path=>{const result=[];let pending='';for(const line of readFileSync(path,'utf8').split(/\r?\n/)){if(!line.trim())continue;pending+=line+'\n';try{const row=JSON.parse(pending);result.push(row);pending='';}catch{}}assert.equal(pending.trim(),'','Truncated JSON document');return result;};
const raw=readDocuments(input),records=raw.filter(r=>r.mode),metadata=raw.filter(r=>r.event);
assert.equal(records.length,160);assert.equal(metadata.find(r=>r.event==='final').wrongCohort,0);
const flat=n=>[n,...(n.Plans??[]).flatMap(flat)],round=x=>Number(x.toFixed(3));
const stat=a=>{a=[...a].sort((a,b)=>a-b);return {samples:a.length,avg:round(a.reduce((n,x)=>n+x,0)/a.length),p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)};};
const rows=records.map(r=>{
 assert.equal(r.checks,'PASS');const top=r.plan[0],root=top.Plan,nodes=flat(root);
 const aggregates=nodes.filter(n=>n['Node Type']==='Aggregate'&&flat(n).some(c=>c['Relation Name']==='article_likes'));
 const scans=nodes.filter(n=>n['Relation Name']==='article_likes');
 const lookup=nodes.filter(n=>n['Node Type']==='CTE Scan'&&n['Parent Relationship']==='SubPlan'&&n['CTE Name']==='incoming');
 if(r.mode==='full'||r.mode==='precount-upsert'||r.mode==='write-only')assert.equal(root['Conflicting Tuples'],64);
 return {stage:r.stage,timing:r.timing,mode:r.mode,iteration:r.iteration,checks:'PASS',executionMs:top['Execution Time'],planningMs:top['Planning Time'],heapFetches:scans.reduce((n,s)=>n+(s['Heap Fetches']??0),0),likeRows:round(scans.reduce((n,s)=>n+s['Actual Rows']*s['Actual Loops'],0)),likeHits:scans.reduce((n,s)=>n+s['Shared Hit Blocks'],0),rootHits:root['Shared Hit Blocks']??0,walBytes:root['WAL Bytes']??0,
 countSubtreeMs:r.timing?round(aggregates.reduce((n,s)=>n+s['Actual Total Time']*s['Actual Loops'],0)):null,lookupMs:r.timing?round(lookup.reduce((n,s)=>n+s['Actual Total Time']*s['Actual Loops'],0)):null,plan:sanitizeNode(root)};
});
const groups=[];
for(const stage of ['before-vacuum','after-vacuum'])for(const timing of [false,true])for(const mode of ['full','count-only','precount-upsert','write-only']){
 const a=rows.filter(r=>r.stage===stage&&r.timing===timing&&r.mode===mode);assert.equal(a.length,10);assert.equal(new Set(a.map(r=>r.iteration)).size,10);
 groups.push({stage,timing,mode,executionMs:stat(a.map(r=>r.executionMs)),planningMs:stat(a.map(r=>r.planningMs)),heapFetches:stat(a.map(r=>r.heapFetches)),likeRows:stat(a.map(r=>r.likeRows)),rootHits:stat(a.map(r=>r.rootHits)),walBytes:stat(a.map(r=>r.walBytes)),countSubtreeMs:timing?stat(a.map(r=>r.countSubtreeMs)):null,lookupMs:timing?stat(a.map(r=>r.lookupMs)):null});
}
writeFileSync(output+'.json',JSON.stringify({checks:'PASS',metadata,groups,rows},null,2)+'\n');
const csvRows=rows.map(({plan,...r})=>r),keys=Object.keys(csvRows[0]),cell=v=>v==null?'':'"'+String(v).replaceAll('"','""')+'"';
writeFileSync(output+'.csv',[keys.join(','),...csvRows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\n')+'\n');
console.log(JSON.stringify({checks:'PASS',metadata,groups}));
