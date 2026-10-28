// 同一客户端统计有效写入、已点赞快速返回和秒杀售罄；仅允许本机隔离服务。
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { timedFetchText } from './http-transport-timing.mjs';
import { rateLoad, mixedAssignment } from './rate-load.mjs';
import { startProcessObserver } from './metric-observer-process.mjs';
import {prepareLoadProcesses} from './rate-load-process.mjs';
import {fileURLToPath} from 'node:url';

const scenario = process.env.PERF_COMPARE_SCENARIO ?? 'mixed';
const validScenarios = new Set(['mixed', 'duplicate-like', 'anonymous-view', 'spike']);
const base = process.env.PERF_BASE_URL ?? (scenario === 'spike' ? 'http://127.0.0.1:3005' : 'http://127.0.0.1:18081');
const requests = Number(process.env.PERF_COMPARE_REQUESTS ?? 10000);
const durationSeconds = Number(process.env.PERF_DURATION_SECONDS ?? 0);
const targetRps = Number(process.env.PERF_TARGET_RPS ?? 0);
const sustained = durationSeconds > 0;
const concurrency = Number(process.env.PERF_BURST_CONCURRENCY ?? 100);
const loginConcurrency = Number(process.env.PERF_LOGIN_CONCURRENCY ?? 4);
const articleCount = Number(process.env.PERF_ARTICLE_COUNT ?? 1);
const articleOffset = Number(process.env.PERF_ARTICLE_OFFSET ?? 1);
const articleSlugs = Array.from({ length: Number.isInteger(articleCount) && articleCount > 0 && articleCount <= 2000 ? articleCount : 0 },
  (_, index) => `perf-article-${articleOffset + index}`);
const password = process.env.PERF_USER_PASSWORD;
const timing = process.env.PERF_TIMING === '1';
const timeline = process.env.PERF_TIMELINE === '1';
const postgresCounters = process.env.PERF_PG_COUNTERS === '1';
const transportTiming = process.env.PERF_HTTP_TRANSPORT_TIMING === '1';
const processObserver = process.env.PERF_OBSERVER_PROCESS === '1';
const loadWorkers = Number(process.env.PERF_LOAD_WORKERS ?? 1);
const containerStack = process.env.PERF_CONTAINER_STACK === '1';
const rabbitManagement = process.env.PERF_RABBIT_MANAGEMENT_URL;
const rabbitPassword = process.env.PERF_RABBIT_PASSWORD;
const output = value => console.log(JSON.stringify(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!validScenarios.has(scenario) || !(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)
    || (containerStack && base === 'http://app:8081'))
    || !Number.isInteger(requests) || requests < 1 || requests > 10000
    || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 1000
    || !Number.isInteger(loginConcurrency) || loginConcurrency < 1 || loginConcurrency > 16
    || !Number.isInteger(articleCount) || articleCount < 1 || articleCount > 2000
    || !Number.isInteger(articleOffset) || articleOffset < 1 || articleOffset + articleCount - 1 > 2000
    || !Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > 600
    || ![1,4].includes(loadWorkers)
    || (loadWorkers>1&&(!sustained||concurrency%loadWorkers!==0||(targetRps/(scenario==='mixed'?2:1))%loadWorkers!==0))
    || (sustained && (!['mixed','anonymous-view'].includes(scenario) || durationSeconds < 1
      || !Number.isInteger(targetRps) || targetRps < 1 || targetRps > 2000
      || (scenario === 'mixed' && targetRps % 2 !== 0)))
    || (scenario === 'mixed' && (requests % 2 !== 0 || (!sustained && requests / 2 > 5000)))
    || (scenario !== 'spike' && !password)
    || (timeline && (!timing || !rabbitPassword
      || !(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(rabbitManagement ?? '')
        || (containerStack && rabbitManagement === 'http://rabbitmq:15672'))))) {
  throw new Error('场景、账号密码、请求数、并发数或本机隔离端口配置无效');
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(p * sorted.length) - 1].toFixed(1));
}

async function send(path, options = {}) {
  const start = performance.now();
  try {
    const result = await timedFetchText(base + path, { ...options, signal: AbortSignal.timeout(30_000) },
      transportTiming && options.headers?.['X-Perf-Timing'] === '1');
    return { status: result.response.status, ...result };
  } catch (error) {
    return { status: 'NETWORK_ERROR', ms: performance.now() - start, error: String(error) };
  }
}

class Session {
  cookies = new Map();
  csrf = '';
  get cookie() { return [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '); }
  async request(path, options = {}) {
    const headers = { Cookie: this.cookie, ...(options.headers ?? {}) };
    if (options.method && options.method !== 'GET') headers['X-XSRF-TOKEN'] = this.csrf;
    const result = await send(path, { ...options, headers });
    for (const header of result.response?.headers.getSetCookie() ?? []) {
      const [pair] = header.split(';');
      const at = pair.indexOf('=');
      if (at > 0) this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return result;
  }
  async refreshCsrf() {
    const response = await this.request('/api/v1/auth/csrf');
    if (response.status !== 200) throw new Error(`CSRF HTTP ${response.status}`);
    this.csrf = JSON.parse(response.body).token;
  }
  async login(username) {
    await this.refreshCsrf();
    const response = await this.request('/api/v1/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (response.status !== 200) throw new Error(`登录 ${username} HTTP ${response.status}`);
    await this.refreshCsrf();
  }
}

async function pool(count, concurrencyLimit, task) {
  const results = new Array(count);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(count, concurrencyLimit) }, async () => {
    while (next < count) {
      const index = next++;
      results[index] = await task(index);
    }
  }));
  return results;
}

function parseTiming(header) {
  if (!header) return null;
  const entries = header.split(',').map(part => /^\s*([A-Za-z]+);dur=([\d.]+)\s*$/.exec(part));
  if (entries.some(entry => !entry)) return null;
  return Object.fromEntries(entries.map(entry => [entry[1], Number(entry[2])]));
}

function resultOf(response, completedAtMs, kind, operation, articleSlug = null) {
  let businessResult = 'unknown';
  try {
    const body = JSON.parse(response.body);
    if (kind === 'spike') businessResult = body.code === 1 ? 'accepted' : body.code === -1 ? 'sold-out' : 'unexpected';
    else businessResult = body.changed === true ? 'changed' : body.changed === false ? 'unchanged' : 'unexpected';
  } catch { /* HTTP 错误或无 JSON 正文仍保留状态与耗时。 */ }
  let dbCounts = null;
  try { dbCounts = JSON.parse(response.response?.headers.get('x-perf-db-counts') ?? 'null'); } catch {}
  return { operation, articleSlug, status: response.status, businessResult, ms: response.ms, completedAtMs,
    completedAtEpochMs: Date.now(),
    dbCounts,
    transport: response.transport,
    timing: parseTiming(response.response?.headers.get('server-timing')) };
}

async function loadUnit(index,sessions,users,start){
  const assignment=scenario==='mixed'?mixedAssignment(index,users,articleCount):{user:0,article:index%articleCount};
  const session=sessions[assignment.user],slug=articleSlugs[assignment.article];
  const headers=timing?{'X-Perf-Timing':'1'}:{};
  const view=await session.request(`/api/v1/articles/${slug}/views`,{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()}});
  const rows=[resultOf(view,performance.now()-start,scenario,'view',slug)];
  if(scenario==='mixed'){
    const like=await session.request(`/api/v1/articles/${slug}/like`,{method:'PUT',headers});
    rows.push(resultOf(like,performance.now()-start,scenario,'like',slug));
  }return rows;
}

async function workerMain(){
  let config,sessions,started=false;
  process.on('disconnect',()=>process.exit());
  process.on('message',async m=>{
    try{
      if(m.type==='init'){
        config=m.config;sessions={};
        for(const s of config.sessions){const session=new Session();session.cookies=new Map(s.cookies);session.csrf=s.csrf;sessions[s.user]=session;}
        process.send({type:'ready'});
      }else if(m.type==='start'&&!started){
        started=true;const start=performance.now()+m.startEpochMs-Date.now();
        if(start>performance.now())await sleep(start-performance.now());
        const histogram=monitorEventLoopDelay({resolution:10}),cpuStart=process.cpuUsage(),loopStart=performance.eventLoopUtilization();
        histogram.enable();
        const unitSize=scenario==='mixed'?2:1,unitRate=targetRps/unitSize;
        const load=await rateLoad({seconds:config.seconds,rate:unitRate/config.workers,concurrency:concurrency/config.workers,
          startAtMs:start,phaseMs:config.index*1000/unitRate,retainLateness:true,
          task:index=>loadUnit(index*config.workers+config.index,sessions,config.users,start)});
        histogram.disable();const cpu=process.cpuUsage(cpuStart),elapsed=(performance.now()-start)/1000;
        const runtime={pid:process.pid,seconds:elapsed,nodeVersion:process.version,platform:process.platform,arch:process.arch,undiciVersion:process.versions.undici,
          cpuUserMs:cpu.user/1000,cpuSystemMs:cpu.system/1000,eventLoopUtilization:performance.eventLoopUtilization(loopStart).utilization,
          loopDelayMeanMs:histogram.mean/1e6,loopDelayP95Ms:histogram.percentile(95)/1e6,loopDelayP99Ms:histogram.percentile(99)/1e6,loopDelayMaxMs:histogram.max/1e6};
        const results=load.results.flatMap(r=>r.value);delete load.results;
        for(let i=0;i<results.length;i+=500)await new Promise((resolve,reject)=>process.send({type:'results',rows:results.slice(i,i+500)},error=>error?reject(error):resolve()));
        process.send({type:'complete',load,runtime});
      }
    }catch{process.send({type:'failed'});}
  });
}

function summarizeArticles(results) {
  if (articleCount === 1) return;
  const groups = new Map(articleSlugs.map(slug => [slug, []]));
  for (const result of results) groups.get(result.articleSlug).push(result);
  const rows = [...groups].map(([articleSlug, group]) => ({
    event: 'article-latency-summary', scenario, articleSlug, requests: group.length,
    changed: group.filter(result => result.businessResult === 'changed').length,
    p50Ms: percentile(group.map(result => result.ms), .5),
    p95Ms: percentile(group.map(result => result.ms), .95),
    p99Ms: percentile(group.map(result => result.ms), .99),
    firstCompletedAtMs: Number(Math.min(...group.map(result => result.completedAtMs)).toFixed(1)),
    lastCompletedAtMs: Number(Math.max(...group.map(result => result.completedAtMs)).toFixed(1))
  }));
  for (const row of rows) output(row);
  output({ event: 'article-fairness-summary', scenario, articleCount,
    minRequests: Math.min(...rows.map(row => row.requests)), maxRequests: Math.max(...rows.map(row => row.requests)),
    minArticleP95Ms: Math.min(...rows.map(row => row.p95Ms)), maxArticleP95Ms: Math.max(...rows.map(row => row.p95Ms)),
    earliestArticleLastCompletedMs: Math.min(...rows.map(row => row.lastCompletedAtMs)),
    latestArticleLastCompletedMs: Math.max(...rows.map(row => row.lastCompletedAtMs)) });
}

function summarize(results, seconds, operation = null) {
  const statuses = {}, outcomes = {}, durations = [];
  for (const result of results) {
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    outcomes[result.businessResult] = (outcomes[result.businessResult] ?? 0) + 1;
    durations.push(result.ms);
  }
  output({ event: operation ? 'comparison-operation-result' : 'comparison-result', scenario,
    articleCount, articleOffset,
    ...(operation ? { operation } : {}), requests: results.length, concurrency,
    seconds: Number(seconds.toFixed(2)), rps: Number((results.length / seconds).toFixed(1)),
    statuses, outcomes, p50Ms: percentile(durations, .5), p95Ms: percentile(durations, .95),
    p99Ms: percentile(durations, .99) });
  const measured = results.filter(result => result.timing);
  const transport = results.filter(result => result.transport);
  if (transport.length) {
    const stages = {};
    const stats = values => ({ samples: values.length,
      totalMs: Number(values.reduce((a,b)=>a+b,0).toFixed(3)),
      avgMs: Number((values.reduce((a,b)=>a+b,0)/values.length).toFixed(3)),
      p50Ms: percentile(values,.5),p95Ms:percentile(values,.95),p99Ms:percentile(values,.99) });
    for (const key of new Set(transport.flatMap(row=>Object.keys(row.transport)))) {
      stages[key] = stats(transport.map(row=>row.transport[key]).filter(Number.isFinite));
    }
    const matched = transport.filter(row=>Number.isFinite(row.timing?.tomcatPreFilter));
    if (matched.length) {
      // Includes server admission/network/response preparation outside the measured Tomcat interval.
      stages.awaitHeadersResidual = stats(matched.map(row=>row.transport.clientAwaitHeaders
        -row.timing.tomcatPreFilter-row.timing.preController-row.timing.controller));
    }
    output({ event: operation ? 'comparison-operation-transport' : 'comparison-transport',scenario,
      ...(operation ? {operation} : {}),samples:transport.length,missing:results.length-transport.length,stages });
  }
  if (measured.length) {
    const stages = {};
    for (const key of new Set(measured.flatMap(result => Object.keys(result.timing)))) {
      const values = measured.map(result => result.timing[key]).filter(Number.isFinite);
      stages[key] = { samples: values.length, avgMs: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
        p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99),
        maxMs: Number(values.reduce((max,value)=>Math.max(max,value),-Infinity).toFixed(3)) };
    }
    const outsideServlet = measured.map(result => Math.max(0, result.ms
      - result.timing.preController - result.timing.controller));
    output({ event: operation ? 'comparison-operation-timing' : 'comparison-timing', scenario,
      ...(operation ? { operation } : {}), samples: measured.length, stages,
      outsideMeasuredStages: { avgMs: Number((outsideServlet.reduce((sum, value) => sum + value, 0)
        / outsideServlet.length).toFixed(2)), p50Ms: percentile(outsideServlet, .5),
        p95Ms: percentile(outsideServlet, .95) } });
    const jdbc = measured.filter(result => result.dbCounts);
    if (jdbc.length) {
      const counts = {};
      for (const key of Object.keys(jdbc[0].dbCounts)) {
        const total = jdbc.reduce((sum, result) => sum + result.dbCounts[key], 0);
        counts[key] = { total, avgPerRequest: Number((total / jdbc.length).toFixed(3)) };
      }
      output({ event: operation ? 'comparison-operation-jdbc-counts' : 'comparison-jdbc-counts', scenario,
        ...(operation ? { operation } : {}), samples: jdbc.length, counts });
    }
  }
}

function summarizeConnectionAcquisitionBySecond(results, burstStartedAtEpochMs) {
  const seconds = new Map();
  for (const result of results) {
    if (!result.timing) continue;
    const index = Math.max(0, Math.floor((result.completedAtEpochMs - burstStartedAtEpochMs) / 1000));
    if (!seconds.has(index)) seconds.set(index, []);
    seconds.get(index).push(result);
  }
  for (const [index, bucket] of [...seconds].sort(([a], [b]) => a - b)) {
    const pre = bucket.map(result => result.timing.dbAcquirePre ?? 0);
    const controller = bucket.map(result => result.timing.dbAcquireController ?? 0);
    const avg = values => Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
    output({ event: 'connection-acquire-second', scenario,
      secondStartEpochMs: burstStartedAtEpochMs + index * 1000, requests: bucket.length,
      preAvgMs: avg(pre), preP95Ms: percentile(pre, .95),
      controllerAvgMs: avg(controller), controllerP95Ms: percentile(controller, .95) });
    const transport = bucket.filter(row=>row.transport);
    if (transport.length) {
      const stages = {};
      for (const key of Object.keys(transport[0].transport)) {
        const values = transport.map(row=>row.transport[key]).filter(Number.isFinite);
        stages[key] = {samples:values.length,avgMs:avg(values),p95Ms:percentile(values,.95)};
      }
      stages.tomcatPreFilter = {avgMs:avg(transport.map(row=>row.timing.tomcatPreFilter)),
        p95Ms:percentile(transport.map(row=>row.timing.tomcatPreFilter),.95)};
      output({event:'http-transport-completed-second',scenario,
        secondStartEpochMs:burstStartedAtEpochMs+index*1000,requests:transport.length,stages});
    }
    const jdbc = bucket.filter(result => result.dbCounts);
    if (jdbc.length) {
      const stages = {};
      for (const key of Object.keys(jdbc[0].timing).filter(key => key.startsWith('jdbc') || key.startsWith('dbHold') || key === 'dbClose')) {
        const values = jdbc.map(result => result.timing[key]);
        stages[key] = { totalMs: Number(values.reduce((sum, value) => sum + value, 0).toFixed(3)),
          avgMs: avg(values), p95Ms: percentile(values, .95) };
      }
      output({ event: 'jdbc-completed-second', scenario, secondStartEpochMs: burstStartedAtEpochMs + index * 1000,
        requests: jdbc.length, stages });
    }
  }
}

async function queueDepth() {
  const started = performance.now();
  try {
    const response = await fetch(`${rabbitManagement}/api/queues/%2F/airchord.article.metrics.q`, {
      headers: { Authorization: `Basic ${Buffer.from(`air_perf:${rabbitPassword}`).toString('base64')}` },
      signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`RabbitMQ management HTTP ${response.status}`);
    const body = await response.json();
    return { queueSampledAtEpochMs: Date.now(), queueReady: body.messages_ready ?? 0,
      queueUnacked: body.messages_unacknowledged ?? 0, queueTotal: body.messages ?? 0,
      queueProbeMs: Number((performance.now() - started).toFixed(1)) };
  } catch (error) {
    return { queueSampledAtEpochMs: Date.now(), queueProbeError: String(error),
      queueProbeMs: Number((performance.now() - started).toFixed(1)) };
  }
}

function startObserver(session) {
  if (!timing) return { stop: async () => {}, waitForDrain: async () => {} };
  let done = false;
  const samples = [];
  const worker = (async () => {
    while (!done) {
      const [response, queue] = await Promise.all([
        session.request('/api/v1/perf/article-metrics-waits'),
        timeline ? queueDepth() : Promise.resolve({})]);
      if (response.status === 200) {
        samples.push({ ...JSON.parse(response.body), ...queue,
          clientProbeMs: Number(response.ms.toFixed(1)) });
      } else {
        samples.push({ status: response.status, ...queue,
          clientProbeMs: Number(response.ms.toFixed(1)) });
      }
      if (!done) await sleep(timeline ? 500 : 200);
    }
  })();
  return { waitForDrain: async afterEpochMs => {
    if (!timeline) return;
    for (let attempt = 0; attempt < 360; attempt++) {
      const recent = samples.filter(sample => sample.sampledAtEpochMs >= afterEpochMs).slice(-2);
      if (recent.length === 2 && recent.every(sample => sample.status === undefined
          && sample.outboxPending === 0 && sample.queueReady === 0 && sample.queueUnacked === 0)) {
        output({ event: 'pipeline-drained', scenario, atEpochMs: recent[1].sampledAtEpochMs });
        return;
      }
      await sleep(500);
    }
    throw new Error('outbox 与 RabbitMQ 队列未在 180 秒内同时排空');
  }, stop: async () => {
    done = true;
    await worker;
    for (const sample of samples) output({ event: 'wait-sample', scenario, ...sample });
    const valid = samples.filter(sample => sample.status === undefined);
    const max = key => Math.max(0, ...valid.map(sample => sample[key]).filter(Number.isFinite));
    const observedDbWaitEvents = [...new Set(valid.flatMap(sample =>
      (sample.dbWaitEvents ?? '').split(',').filter(Boolean)))].sort();
    output({ event: 'wait-summary', scenario, samples: valid.length, probeFailures: samples.length - valid.length,
      maxPoolActive: max('poolActive'), maxPoolPending: max('poolPending'),
      maxOutboxPending: max('outboxPending'), maxQueueReady: max('queueReady'),
      maxQueueUnacked: max('queueUnacked'),
      queueProbeFailures: samples.filter(sample => sample.queueProbeError).length,
      maxDbActive: max('dbActive'), maxDbLockWait: max('dbLockWait'), maxDbIoWait: max('dbIoWait'),
      maxDbOtherWait: max('dbOtherWait'), observedDbWaitEvents,
      maxDbProbeMs: max('dbProbeMs'), maxClientProbeMs: max('clientProbeMs') });
  } };
}

async function waitForCount(session, field, expectedByArticle) {
  const expected = expectedByArticle.reduce((sum, value) => sum + value, 0);
  for (let attempt = 1; attempt <= 180; attempt++) {
    const stats = await currentStatsByArticle(session);
    if (stats.every((row, index) => row[field] === expectedByArticle[index])) {
      output({ event: 'count-converged', scenario, field, expected, articleCount, attempts: attempt });
      return;
    }
    await sleep(1000);
  }
  throw new Error(`${field} 未在 180 秒内达到 ${expected}`);
}

async function currentStatsByArticle(session) {
  return pool(articleCount, Math.min(articleCount, 4), async index => {
    const response = await session.request(`/api/v1/articles/${articleSlugs[index]}/stats`);
    if (response.status !== 200) throw new Error(`读取压测文章统计失败: HTTP ${response.status}`);
    return JSON.parse(response.body);
  });
}

async function snapshotPostgres(session, phase) {
  if (!postgresCounters) return;
  const response = await session.request('/api/v1/perf/article-metrics-postgres');
  if (response.status !== 200) throw new Error('PostgreSQL counter probe HTTP ' + response.status);
  const snapshot = JSON.parse(response.body);
  const settings = Object.fromEntries(snapshot.settings.map(row => [row.name, row.setting]));
  for (const name of ['fsync','synchronous_commit','track_io_timing','track_wal_io_timing']) {
    if (settings[name] !== 'on') throw new Error('PostgreSQL setting must be on: ' + name);
  }
  output({ event: 'postgres-snapshot', scenario, phase, ...snapshot });
}

async function main() {
  if (scenario === 'spike') {
    const start = performance.now();
    const results = await pool(requests, concurrency, async () => {
      const response = await send('/buy/ticket');
      return resultOf(response, performance.now() - start, 'spike', 'buy');
    });
    summarize(results, (performance.now() - start) / 1000);
    if (results.some(result => result.status !== 200
        || (result.businessResult !== 'accepted' && result.businessResult !== 'sold-out'))) {
      throw new Error('秒杀请求有 HTTP 或业务结果异常');
    }
    return;
  }

  const health = await send('/api/v1/health');
  if (health.status !== 200) throw new Error(`Air 隔离栈未就绪: HTTP ${health.status}`);
  const users = scenario === 'mixed' ? (sustained ? 5000 : requests / 2) : 1;
  if(sustained && scenario==='mixed' && durationSeconds*targetRps/2>users*articleCount)
    throw new Error('长测请求超过唯一用户/文章组合容量');
  const sessions = new Array(users);
  const preparationStart = performance.now();
  if (scenario === 'anonymous-view') {
    sessions[0] = new Session();
    await sessions[0].refreshCsrf();
  } else {
    await pool(users, loginConcurrency, async index => {
      const session = new Session();
      await session.login(`metric-user-${index + 1}`);
      sessions[index] = session;
    });
  }
  if (scenario === 'duplicate-like') {
    const warmup = await sessions[0].request(`/api/v1/articles/${articleSlugs[0]}/like`, { method: 'PUT' });
    if (warmup.status !== 200) throw new Error(`点赞预热 HTTP ${warmup.status}`);
  }
  let probeSession = sessions[0];
  if (timing && scenario === 'anonymous-view') {
    // 探针要求登录，但突发浏览仍保持匿名请求语义。
    probeSession = new Session();
    await probeSession.login('metric-user-1');
  }
  const beforeRows = scenario === 'mixed' || scenario === 'anonymous-view' ? await currentStatsByArticle(sessions[0]) : null;
  const before = beforeRows?.reduce((sum, row) => ({ viewCount: sum.viewCount + row.viewCount,
    likeCount: sum.likeCount + row.likeCount }), { viewCount: 0, likeCount: 0 });
  if (scenario === 'mixed' && beforeRows.some(row => row.viewCount !== 0 || row.likeCount !== 0)) {
    throw new Error('mixed 有效写测试要求所选文章尚无浏览和点赞统计');
  }
  output({ event: 'comparison-ready', scenario, users, seconds: Number(((performance.now() - preparationStart) / 1000).toFixed(1)),
    articleCount, articleOffset,
    initialStats: before });
  if (timing) {
    const probe = await probeSession.request('/api/v1/perf/article-metrics-waits');
    if (probe.status !== 200) throw new Error(`等待指标探针不可用: HTTP ${probe.status}；请用当前源码重建镜像并开启 PERF_TIMING_ENABLED=true`);
    if (transportTiming) {
      const snapshot = JSON.parse(probe.body);
      const expectedPool = Number(process.env.PERF_DB_POOL_SIZE ?? 10),backgroundPool=Number(process.env.PERF_BACKGROUND_POOL_SIZE??0);
      if (snapshot.poolMaximum !== expectedPool-backgroundPool || snapshot.poolMinimumIdle !== expectedPool-backgroundPool
          ||(backgroundPool>0&&(snapshot.backgroundPool?.maximum!==backgroundPool||snapshot.backgroundPool?.minimumIdle!==backgroundPool))) {
        throw new Error('Actual Hikari configuration differs from requested pool size');
      }
      output({event:'pool-config-verified',maximum:snapshot.poolMaximum,minimumIdle:snapshot.poolMinimumIdle,background:snapshot.backgroundPool??null,totalMaximum:expectedPool});
    }
  }
  if (timeline) {
    const queue = await queueDepth();
    if (queue.queueProbeError) throw new Error(`RabbitMQ 队列探针不可用: ${queue.queueProbeError}`);
  }
  // Exclude preparation and wait for statistics to flush before the baseline.
  if (postgresCounters) await sleep(1500);
  await snapshotPostgres(probeSession, 'before-burst');
  const observer = processObserver ? await startProcessObserver({base,rabbitManagement,rabbitPassword,
    cookie:probeSession.cookie,scenario,containerStack,postgresCounters},output) : startObserver(probeSession);
  let processes;
  if(loadWorkers>1){
    const configs=Array.from({length:loadWorkers},(_,index)=>({seconds:durationSeconds,users,
      sessions:sessions.flatMap((s,user)=>scenario==='anonymous-view'||user%loadWorkers===index?[{user,cookies:[...s.cookies],csrf:s.csrf}]:[])}));
    try{processes=await prepareLoadProcesses(fileURLToPath(import.meta.url),configs);}
    catch(error){await observer.stop();throw error;}
    output({event:'load-processes',workers:loadWorkers,pids:processes.pids,generatorPid:process.pid});
  }
  const burstStartedAtEpochMs = Date.now()+(processes?500:0);
  const processRun=processes?.run(burstStartedAtEpochMs);
  processRun?.catch(()=>{});
  if(processes)await sleep(Math.max(0,burstStartedAtEpochMs-Date.now()));
  output({ event: 'burst-start', scenario, articleCount, articleOffset, atEpochMs: burstStartedAtEpochMs });
  const start = performance.now();
  let results;
  let sustainedStats;
  let workerRuntimes;
  let burstEndedAtEpochMs;
  const loopDelay = transportTiming ? monitorEventLoopDelay({resolution:10}) : null;
  const loopStart = performance.eventLoopUtilization();
  const cpuStart = process.cpuUsage();
  loopDelay?.enable();
  try {
    try {
      if (sustained) {
        const unitSize=scenario==='mixed'?2:1;
        let load;
        if(processRun){const completed=await processRun;load=completed.load;results=completed.results;workerRuntimes=completed.runtimes;}
        else{load=await rateLoad({seconds:durationSeconds,rate:targetRps/unitSize,concurrency,task:index=>loadUnit(index,sessions,users,start)});results=load.results.flatMap(row=>row.value);}
        sustainedStats={event:'sustained-load',scenario,durationSeconds,targetRps,unitSize,
          plannedRequests:load.planned*unitSize,startedRequests:load.started*unitSize,
          droppedBusyRequests:load.droppedBusy*unitSize,droppedLateRequests:load.droppedLate*unitSize,
          maxActive:load.maxActive,maxActiveAggregation:load.maxActiveAggregation??'observed',elapsedSeconds:load.elapsedSeconds,lateness:load.lateness};
        for(const row of load.seconds)output({event:'sustained-arrival-second',scenario,
          second:row.second,secondStartEpochMs:burstStartedAtEpochMs+row.second*1000,
          plannedRequests:row.planned*unitSize,startedRequests:row.started*unitSize,
          droppedBusyRequests:row.droppedBusy*unitSize,droppedLateRequests:row.droppedLate*unitSize});
      } else if (scenario === 'mixed') {
        const pairs = await pool(users, concurrency, async index => {
          const session = sessions[index];
          const slug = articleSlugs[index % articleCount];
          const headers = timing ? { 'X-Perf-Timing': '1' } : {};
          const view = await session.request(`/api/v1/articles/${slug}/views`, {
            method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() } });
          const viewResult = resultOf(view, performance.now() - start, scenario, 'view', slug);
          const like = await session.request(`/api/v1/articles/${slug}/like`, { method: 'PUT', headers });
          return [viewResult, resultOf(like, performance.now() - start, scenario, 'like', slug)];
        });
        results = pairs.flat();
      } else {
        results = await pool(requests, concurrency, async index => {
          const isView = scenario === 'anonymous-view';
          const response = await sessions[0].request(
            `/api/v1/articles/${articleSlugs[index % articleCount]}/${isView ? 'views' : 'like'}`,
            { method: isView ? 'POST' : 'PUT', headers: {
              ...(isView ? { 'Idempotency-Key': randomUUID() } : {}),
              ...(timing ? { 'X-Perf-Timing': '1' } : {}) } });
          return resultOf(response, performance.now() - start, scenario, isView ? 'view' : 'like', articleSlugs[index % articleCount]);
        });
      }
    } finally {
      const elapsed = (performance.now() - start) / 1000;
      burstEndedAtEpochMs = workerRuntimes?burstStartedAtEpochMs+Math.round(Math.max(...workerRuntimes.map(r=>r.seconds))*1000):Date.now();
      if (loopDelay) {
        loopDelay.disable();
        const cpu = process.cpuUsage(cpuStart);
        const utilization = performance.eventLoopUtilization(loopStart);
        const coordinator={event:'client-runtime',scenario,seconds:elapsed,nodeVersion:process.version,
          platform:process.platform,arch:process.arch,
          undiciVersion:process.versions.undici,cpuUserMs:cpu.user/1000,cpuSystemMs:cpu.system/1000,
          eventLoopUtilization:utilization.utilization,
          loopDelayMeanMs:loopDelay.mean/1e6,loopDelayP95Ms:loopDelay.percentile(95)/1e6,
          loopDelayP99Ms:loopDelay.percentile(99)/1e6,loopDelayMaxMs:loopDelay.max/1e6};
        if(workerRuntimes){
          output({...coordinator,event:'coordinator-runtime'});
          const total=k=>workerRuntimes.reduce((n,r)=>n+r[k],0),max=k=>Math.max(...workerRuntimes.map(r=>r[k]));
          output({...coordinator,seconds:(burstEndedAtEpochMs-burstStartedAtEpochMs)/1000,
            cpuUserMs:total('cpuUserMs'),cpuSystemMs:total('cpuSystemMs'),eventLoopUtilization:total('eventLoopUtilization')/loadWorkers,
            loopDelayMeanMs:total('loopDelayMeanMs')/loadWorkers,loopDelayP95Ms:max('loopDelayP95Ms'),loopDelayP99Ms:max('loopDelayP99Ms'),loopDelayMaxMs:max('loopDelayMaxMs'),
            loopDelayP99Aggregation:'max-worker-p99-not-global-percentile',eventLoopUtilizationAggregation:'mean-workers',workers:workerRuntimes});
        }else output(coordinator);
      }
      output({ event: 'burst-end', scenario, atEpochMs: burstEndedAtEpochMs,
        seconds: Number(((burstEndedAtEpochMs-burstStartedAtEpochMs)/1000).toFixed(2)) });
      if (results) {
        if(sustainedStats)output(sustainedStats);
        if(sustainedStats && durationSeconds>10) {
          const steady=results.filter(row=>row.completedAtMs>=10000&&row.completedAtMs<durationSeconds*1000);
          output({event:'sustained-steady-window',scenario,startSecond:10,endSecond:durationSeconds,
            completedRequests:steady.length,rps:steady.length/(durationSeconds-10),
            p50Ms:percentile(steady.map(row=>row.ms),.5),p95Ms:percentile(steady.map(row=>row.ms),.95),
            p99Ms:percentile(steady.map(row=>row.ms),.99)});
        }
        const requestSeconds=(burstEndedAtEpochMs-burstStartedAtEpochMs)/1000;
        summarize(results, requestSeconds);
        summarizeArticles(results);
        if (timeline) summarizeConnectionAcquisitionBySecond(results, burstStartedAtEpochMs);
        if (scenario === 'mixed') {
          for (const operation of ['view', 'like']) {
            summarize(results.filter(result => result.operation === operation), requestSeconds, operation);
          }
        }
      }
    }
    await snapshotPostgres(probeSession, 'after-http');
    if (!results) throw new Error('突发请求未完成');
    const expected = scenario === 'duplicate-like' ? 'unchanged' : 'changed';
    if (results.some(result => result.businessResult !== expected
        || result.status !== (result.operation === 'view' ? 202 : 200))) {
      throw new Error(`有请求未达到预期业务结果 ${expected}`);
    }
    if (scenario === 'mixed') {
      const expected = sustained ? articleSlugs.map(slug=>results.filter(row=>row.operation==='view'&&row.articleSlug===slug).length)
        : articleSlugs.map((_, index) => Math.max(0, Math.ceil((users - index) / articleCount)));
      await waitForCount(sessions[0], 'viewCount', expected);
      await waitForCount(sessions[0], 'likeCount', expected);
    } else if (scenario === 'anonymous-view') {
      await waitForCount(sessions[0], 'viewCount', beforeRows.map((row, index) => row.viewCount
        + (sustained?results.filter(result=>result.articleSlug===articleSlugs[index]).length
          :Math.max(0, Math.ceil((requests - index) / articleCount)))));
    }
    await observer.waitForDrain(burstEndedAtEpochMs);
    if (postgresCounters) await sleep(1500);
    await snapshotPostgres(probeSession, 'after-drain');
  } finally {
    processes?.stop();
    await observer.stop();
  }
}

if(process.env.PERF_LOAD_WORKER==='1')await workerMain();
else main().catch(error => { console.error(error); process.exitCode = 1; });
