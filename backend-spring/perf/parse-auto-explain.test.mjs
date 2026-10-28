import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {parsePlans,sanitizeNode} from './parse-auto-explain.mjs';
test('plan export removes SQL, parameters and predicates recursively',()=>{
 const result=sanitizeNode({'Node Type':'Update',Filter:'secret',Plans:[{'Node Type':'Index Scan','Index Name':'pending_idx','Index Cond':'secret','Actual Rows':200,'Rows Removed by Filter':9000}]});
 assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(result.Plans[0]['Rows Removed by Filter'],9000);
});
test('generic-plan detection retains only parameter presence',()=>{
 assert.equal(sanitizeNode({Filter:'id = ANY (ARRAY[$1,$2])'}).parameterizedFilter,true);
 assert.equal(sanitizeNode({Filter:'id = ANY (ARRAY[private])'}).parameterizedFilter,false);
 assert.equal(JSON.stringify(sanitizeNode({'Index Cond':'id=$123'})).includes('$123'),false);
});
test('stats export retains conflict/count structure and timing without business data',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'article-stats-plan-'));try{
  const plan={'Query Text':'WITH incoming(article_id, view_delta, refresh_likes) AS (VALUES (private)) INSERT INTO article_stats SELECT private',Plan:{'Node Type':'ModifyTable','Tuples Inserted':0,'Conflicting Tuples':64,Plans:[{'Node Type':'Index Only Scan','Relation Name':'article_likes','Heap Fetches':50000,'Actual Loops':48,'Actual Total Time':.5,'Index Cond':'article_id = private'}]}};
  writeFileSync(join(dir,'log'),`2026-09-27 08:00:00.123 UTC [91] LOG:  duration: 44.209 ms  plan:\n${JSON.stringify(plan,null,2)}\n`);
  assert.equal((await parsePlans(join(dir,'log'))).length,0);
  const rows=await parsePlans(join(dir,'log'),'stats');assert.equal(rows.length,1);assert.equal(rows[0].plan['Conflicting Tuples'],64);assert.equal(rows[0].plan.Plans[0]['Heap Fetches'],50000);assert.equal(rows[0].plan.Plans[0]['Actual Total Time'],.5);assert.ok(!JSON.stringify(rows).includes('private'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('multiline actual plan preserves timestamp, PID and rows; ignores other SQL',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'article-plan-'));try{
  const plan=q=>JSON.stringify({'Query Text':q,Plan:{'Node Type':'ModifyTable',Plans:[{'Node Type':'Index Scan','Actual Rows':200}]}},null,2);
  writeFileSync(join(dir,'log'),`2026-09-27 08:00:00.123 UTC [91] LOG:  duration: 44.209 ms  plan:\n${plan('UPDATE article_metric_outbox SET published_at = now()')}\n2026-09-27 08:00:01.123 UTC [92] LOG:  duration: 45.2 ms  plan:\n${plan('SELECT private')}\n`);
  const rows=await parsePlans(join(dir,'log'));assert.equal(rows.length,1);assert.equal(rows[0].pid,91);assert.equal(rows[0].durationMs,44.209);assert.equal(rows[0].atEpochMs,Date.parse('2026-09-27T08:00:00.123Z'));assert.equal(rows[0].plan.Plans[0]['Actual Rows'],200);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
