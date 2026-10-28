import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const local=url=>/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url);
export function validateObserver(c){
 if(!(local(c.base)||(c.containerStack&&c.base==='http://app:8081'))
   ||!(local(c.rabbitManagement)||(c.containerStack&&c.rabbitManagement==='http://rabbitmq:15672')))
  throw Error('Observer must use isolated local endpoints');
}
export async function startProcessObserver(config,emit){
 validateObserver(config);
 const child=fork(fileURLToPath(import.meta.url),['--worker'],{stdio:['ignore','ignore','inherit','ipc']});
 const pending=new Map();let sequence=0;
 const rpc=(command,payload={},timeout=200_000)=>new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Observer command timed out'));child.kill();},timeout);
  pending.set(id,{resolve,reject,timer});child.send({id,command,...payload});
 });
 const fail=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Observer process exited unexpectedly'));}pending.clear();};
 child.on('error',fail);child.on('exit',fail);
 child.on('message',m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m);});
 await rpc('init',{config},20_000);
 emit({event:'observer-process',scenario:config.scenario,pid:child.pid,generatorPid:process.pid,postgresIntervalSeconds:5});
 return {waitForDrain:async afterEpochMs=>{const r=await rpc('drain',{afterEpochMs});emit({event:'pipeline-drained',scenario:config.scenario,atEpochMs:r.atEpochMs});},
 stop:async()=>{try{const r=await rpc('stop',{},40_000);for(const row of r.rows)emit(row);}finally{if(child.connected)child.disconnect();child.kill();}}};
}
if(process.argv[2]==='--worker'){
 let config,done=false,loop,loopFailure,samples=[],pg=[],lastPg=-Infinity;
 const get=async(url,headers,timeout)=>{
  const start=performance.now();
  try{const response=await fetch(url,{headers,signal:AbortSignal.timeout(timeout)});const body=await response.text();return {status:response.status,body,ms:performance.now()-start};}
  catch{return {status:'NETWORK_ERROR',ms:performance.now()-start};}
 };
 const queue=async()=>{
  const start=performance.now(),r=await get(config.rabbitManagement+'/api/queues/%2F/airchord.article.metrics.q',
    {Authorization:'Basic '+Buffer.from('air_perf:'+config.rabbitPassword).toString('base64')},5000);
  if(r.status!==200)return {queueSampledAtEpochMs:Date.now(),queueProbeError:'management HTTP '+r.status,queueProbeMs:performance.now()-start};
  const b=JSON.parse(r.body);return {queueSampledAtEpochMs:Date.now(),queueReady:b.messages_ready??0,queueUnacked:b.messages_unacknowledged??0,queueTotal:b.messages??0,queueProbeMs:performance.now()-start};
 };
 const collect=async()=>{
  while(!done){
   const [r,q]=await Promise.all([get(config.base+'/api/v1/perf/article-metrics-waits',{Cookie:config.cookie},30_000),queue()]);
   samples.push({event:'wait-sample',scenario:config.scenario,probeCompletedAtEpochMs:Date.now(),
    ...(r.status===200?JSON.parse(r.body):{status:r.status}),...q,clientProbeMs:r.ms});
   if(config.postgresCounters&&performance.now()-lastPg>=5000){
    lastPg=performance.now();const p=await get(config.base+'/api/v1/perf/article-metrics-postgres',{Cookie:config.cookie},30_000);
    pg.push({event:'postgres-interval',scenario:config.scenario,observedAtEpochMs:Date.now(),...(p.status===200?JSON.parse(p.body):{probeError:'postgres HTTP '+p.status})});
   }if(!done)await sleep(500);
  }
 };
 const rows=()=>{
  const valid=samples.filter(r=>r.status===undefined),max=key=>valid.reduce((m,r)=>Number.isFinite(r[key])?Math.max(m,r[key]):m,0);
  return [...samples,...pg,{event:'wait-summary',scenario:config.scenario,samples:valid.length,probeFailures:samples.length-valid.length,
   queueProbeFailures:samples.filter(r=>r.queueProbeError).length,maxPoolActive:max('poolActive'),maxPoolPending:max('poolPending'),maxOutboxPending:max('outboxPending'),
   maxQueueReady:max('queueReady'),maxQueueUnacked:max('queueUnacked'),maxDbActive:max('dbActive'),maxDbLockWait:max('dbLockWait'),maxDbIoWait:max('dbIoWait'),maxDbOtherWait:max('dbOtherWait'),
   maxBackgroundActive:valid.reduce((m,r)=>Math.max(m,r.backgroundPool?.active??0),0),maxBackgroundPending:valid.reduce((m,r)=>Math.max(m,r.backgroundPool?.pending??0),0),
   observedDbWaitEvents:[...new Set(valid.flatMap(r=>(r.dbWaitEvents??'').split(',').filter(Boolean)))].sort(),maxDbProbeMs:max('dbProbeMs'),maxClientProbeMs:max('clientProbeMs')}];
 };
 process.on('disconnect',()=>process.exit());
 process.on('message',async m=>{
  try{
   if(m.command==='init'){config=m.config;validateObserver(config);loop=collect();loop.catch(error=>{loopFailure=error;});process.send({id:m.id});}
   else if(m.command==='drain'){
    for(let attempt=0;attempt<360;attempt++){
     if(loopFailure)throw loopFailure;
     const recent=samples.filter(r=>r.sampledAtEpochMs>=m.afterEpochMs).slice(-2);
     if(recent.length===2&&recent.every(r=>r.status===undefined&&!r.queueProbeError&&r.outboxPending===0&&r.queueReady===0&&r.queueUnacked===0)){
      process.send({id:m.id,atEpochMs:recent[1].sampledAtEpochMs});return;
     }await sleep(500);
    }throw Error('Observer drain did not converge in 180 seconds');
   }else if(m.command==='stop'){done=true;await loop;process.send({id:m.id,rows:rows()});}
  }catch{process.send({id:m.id,error:'Observer collection or command failed'});}
 });
}
