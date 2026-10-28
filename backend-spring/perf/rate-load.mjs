import { performance } from 'node:perf_hooks';

// 有界并发、按时长准入；发压端来不及发送的到达显式记为 dropped，不隐藏为服务器成功。
export async function rateLoad({seconds,rate,concurrency,task,maxLatenessMs=25,startAtMs,phaseMs=0,retainLateness=false,
    now=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  if(!Number.isFinite(seconds)||seconds<=0||!Number.isFinite(rate)||rate<=0
      ||!Number.isInteger(concurrency)||concurrency<1||!Number.isFinite(maxLatenessMs)||maxLatenessMs<0
      ||(startAtMs!==undefined&&!Number.isFinite(startAtMs))||!Number.isFinite(phaseMs)||phaseMs<0||phaseMs>=1000/rate)
    throw new Error('Invalid rate load configuration');
  const planned=Math.floor(seconds*rate),start=startAtMs??now(),end=start+seconds*1000;
  const active=new Set(),results=[],lateness=[];let next=0,busy=0,late=0,maxActive=0;
  const buckets=new Map();
  const bucket=second=>{
    if(!buckets.has(second))buckets.set(second,{second,planned:0,started:0,droppedBusy:0,droppedLate:0});
    return buckets.get(second);
  };
  for(let index=0;index<planned;index++)bucket(Math.floor(index/rate)).planned++;
  const missed=(from,to)=>{for(let index=from;index<to;index++)bucket(Math.floor(index/rate)).droppedLate++;};
  while(next<planned) {
    const deadline=start+phaseMs+next*1000/rate;
    if(now()<deadline) await sleep(deadline-now());
    const time=now();
    if(time>=end){missed(next,planned);late+=planned-next;break;}
    const valid=Math.max(next,Math.ceil((time-start-phaseMs-maxLatenessMs)*rate/1000));
    missed(next,Math.min(planned,valid));late+=Math.min(planned,valid)-next;next=Math.min(planned,valid);
    if(next>=planned)break;
    if(active.size>=concurrency){bucket(Math.floor(next/rate)).droppedBusy++;busy++;next++;continue;}
    const index=next++;
    const promise=Promise.resolve().then(()=>{
      bucket(Math.max(0,Math.floor((now()-start)/1000))).started++;
      lateness.push(Math.max(0,now()-start-phaseMs-index*1000/rate));return task(index);
    }).then(value=>results.push({index,value}),
      error=>results.push({index,error})).finally(()=>active.delete(promise));
    active.add(promise);maxActive=Math.max(maxActive,active.size);
  }
  if(now()<end)await sleep(end-now());
  await Promise.all(active);
  results.sort((a,b)=>a.index-b.index);
  const failure=results.find(row=>row.error);if(failure)throw failure.error;
  const sorted=[...lateness].sort((a,b)=>a-b);
  const percentile=p=>sorted.length?sorted[Math.ceil(sorted.length*p)-1]:null;
  return {results,planned,started:results.length,droppedBusy:busy,droppedLate:late,maxActive,
    elapsedSeconds:(now()-start)/1000,seconds:[...buckets.values()].sort((a,b)=>a.second-b.second),
    ...(retainLateness?{latenessSamples:lateness}:{}),
    lateness:{p50Ms:percentile(.5),p95Ms:percentile(.95),
      p99Ms:percentile(.99),maxMs:sorted.at(-1)??null}};
}

export function mixedAssignment(index,users,articles) {
  if(!Number.isInteger(index)||index<0||!Number.isInteger(users)||users<1
      ||!Number.isInteger(articles)||articles<1||index>=users*articles)
    throw new Error('Mixed assignment exceeds unique user/article pairs');
  const user=index%users;
  return {user,article:(user%articles+Math.floor(index/users))%articles};
}
