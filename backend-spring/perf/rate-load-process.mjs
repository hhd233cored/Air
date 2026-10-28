import {fork} from 'node:child_process';
async function deadline(promise,ms){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Load worker timeout')),ms);})]);}
 finally{clearTimeout(timer);}
}

// Credentials travel only through private IPC. Full request samples return after admission ends.
export async function prepareLoadProcesses(script,configs){
 const children=[],results=[],loads=[],runtimes=[];
 const states=configs.map((config,index)=>{
  const child=fork(script,[],{env:{...process.env,PERF_LOAD_WORKER:'1'},stdio:['ignore','ignore','inherit','ipc']});
  children.push(child);
  let readyResolve,doneResolve,rejectReady,rejectDone;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;rejectReady=reject;});
  const done=new Promise((resolve,reject)=>{doneResolve=resolve;rejectDone=reject;});
  // Avoid unhandled rejection before the coordinated start is dispatched.
  done.catch(()=>{});
  let finished=false;
  const fail=()=>{if(finished)return;rejectReady(Error('Load worker failed'));rejectDone(Error('Load worker failed'));};
  child.on('error',fail);child.on('exit',code=>{if(!finished||code!==0)fail();});
  child.on('message',m=>{
   if(m.type==='ready')readyResolve();
   else if(m.type==='results'){for(const row of m.rows)results.push(row);}
   else if(m.type==='complete'){finished=true;loads[index]=m.load;runtimes[index]=m.runtime;doneResolve();}
   else if(m.type==='failed')fail();
  });
  child.send({type:'init',config:{...config,index,workers:configs.length}});
  return {child,ready,done};
 });
 let stopped=false;
 const stop=()=>{if(stopped)return;stopped=true;for(const child of children){if(child.connected)child.disconnect();child.kill();}};
 try{
  await deadline(Promise.all(states.map(s=>s.ready)),20000);
 }catch(error){stop();throw error;}
 return {pids:children.map(c=>c.pid),stop,run:async startEpochMs=>{
  try{
   for(const s of states)s.child.send({type:'start',startEpochMs});
   await deadline(Promise.all(states.map(s=>s.done)),(configs[0].seconds+120)*1000);
   return {results,load:mergeProcessLoads(loads),runtimes};
  }finally{stop();}
 }};
}

export function mergeProcessLoads(loads){
 const sum=k=>loads.reduce((n,r)=>n+r[k],0),buckets=new Map();
 for(const r of loads)for(const b of r.seconds){if(!buckets.has(b.second))buckets.set(b.second,{second:b.second,planned:0,started:0,droppedBusy:0,droppedLate:0});const all=buckets.get(b.second);for(const k of ['planned','started','droppedBusy','droppedLate'])all[k]+=b[k];}
 const samples=loads.flatMap(r=>r.latenessSamples).sort((a,b)=>a-b);
 const p=q=>samples.length?samples[Math.ceil(samples.length*q)-1]:null;
 const planned=sum('planned'),started=sum('started'),droppedBusy=sum('droppedBusy'),droppedLate=sum('droppedLate');
 if(planned!==started+droppedBusy+droppedLate||samples.length!==started)throw Error('Worker arrival counts mismatch');
 return {planned,started,droppedBusy,droppedLate,maxActive:sum('maxActive'),maxActiveAggregation:'sum-worker-maxima-upper-bound',
  elapsedSeconds:Math.max(...loads.map(r=>r.elapsedSeconds)),seconds:[...buckets.values()].sort((a,b)=>a.second-b.second),
  lateness:{p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),maxMs:samples.at(-1)??null}};
}
