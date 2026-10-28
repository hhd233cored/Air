import {createReadStream,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
// Explicit allowlist: never export Query Text, predicates or business IDs.
const allowed=new Set(['Node Type','Operation','Relation Name','Index Name','Scan Direction',
 'Plan Rows','Actual Rows','Actual Loops','Rows Removed by Filter','Rows Removed by Index Recheck',
 'Heap Fetches','Exact Heap Blocks','Lossy Heap Blocks','Shared Hit Blocks','Shared Read Blocks',
 'Shared Dirtied Blocks','Shared Written Blocks','I/O Read Time','I/O Write Time',
 'WAL Records','WAL FPI','WAL Bytes','Index Searches','Shared I/O Read Time','Shared I/O Write Time',
 'Actual Startup Time','Actual Total Time','Parent Relationship','Subplan Name','CTE Name',
 'Conflict Resolution','Conflict Arbiter Indexes','Tuples Inserted','Conflicting Tuples']);
export function sanitizeNode(node){
 const result=Object.fromEntries(Object.entries(node).filter(([key])=>allowed.has(key)));
 if(node.Filter)result.parameterizedFilter=/\$\d+/.test(node.Filter);
 if(node['Index Cond'])result.parameterizedIndexCond=/\$\d+/.test(node['Index Cond']);
 if(node.Plans)result.Plans=node.Plans.map(sanitizeNode);
 return result;
}
export async function parsePlans(path,kind='mark'){
 if(!['mark','stats'].includes(kind))throw Error('Unknown plan kind');
 const rows=[];let header=null,parts=[];
 for await(const line of createInterface({input:createReadStream(path),crlfDelay:Infinity})){
  const h=/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+) UTC \[(\d+)\] LOG:\s+duration: ([\d.]+) ms\s+plan:/.exec(line);
  if(h){if(header)throw Error('Incomplete auto_explain plan');header={atEpochMs:Date.parse(h[1].replace(' ','T')+'Z'),pid:+h[2],durationMs:+h[3]};parts=[];continue;}
  if(!header)continue;
  parts.push(line.trim());
  if(!/^\s*}\s*$/.test(line))continue;
  let parsed;try{parsed=JSON.parse(parts.join('\n'));}catch{continue;}
  const query=parsed['Query Text']??'';
  const selected=kind==='mark'?/^\s*UPDATE article_metric_outbox SET published_at/i.test(query):/^\s*WITH incoming\s*\(article_id,\s*view_delta,\s*refresh_likes\)/i.test(query);
  if(selected)rows.push({...header,plan:sanitizeNode(parsed.Plan)});
  header=null;parts=[];
 }
 if(header)throw Error('Truncated final auto_explain plan');
 return rows;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [input,output,kind='mark']=process.argv.slice(2);if(!output)throw Error('Usage: parse-auto-explain.mjs postgres.log output.jsonl [mark|stats]');
 const rows=await parsePlans(input,kind);writeFileSync(output,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 console.log(JSON.stringify({kind,[kind==='mark'?'markPlans':'statsPlans']:rows.length,pids:[...new Set(rows.map(r=>r.pid))]}));
}
