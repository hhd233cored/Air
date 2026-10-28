// 独立 air-perf 栈：预先登录虚构账号，再测浏览与点赞链路；绝不请求开发服务。
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

const base = process.env.PERF_BASE_URL ?? 'http://127.0.0.1:18081';
const password = process.env.PERF_USER_PASSWORD;
const users = Number(process.env.PERF_METRIC_USERS ?? 5000);
const loginConcurrency = Number(process.env.PERF_LOGIN_CONCURRENCY ?? 4);
const burstConcurrency = Number(process.env.PERF_BURST_CONCURRENCY ?? 250);
const pauseSeconds = Number(process.env.PERF_PAUSE_BEFORE_DRAIN_SECONDS ?? 0);
const timingEnabled = process.env.PERF_TIMING === '1';
const output = value => console.log(JSON.stringify(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('只允许本机隔离压测端口');
if (!password || !Number.isInteger(users) || users < 1 || users > 5000) throw new Error('账号密码或人数配置无效');
if (!Number.isInteger(burstConcurrency) || burstConcurrency < 1 || burstConcurrency > 5000)
  throw new Error('突发并发用户数配置无效');

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(p * sorted.length) - 1].toFixed(1));
}

async function send(path, options = {}) {
  const start = performance.now();
  try {
    const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(30_000) });
    const body = await response.text();
    return { status: response.status, ms: performance.now() - start, response, body };
  } catch (error) {
    return { status: 'NETWORK_ERROR', ms: performance.now() - start, error: String(error) };
  }
}

class Session {
  cookies = new Map();
  csrf = '';
  get cookie() { return [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '); }
  capture(response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const at = pair.indexOf('=');
      if (at > 0) this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
  }
  async request(path, options = {}) {
    const headers = { Cookie: this.cookie, ...(options.headers ?? {}) };
    if (options.method && options.method !== 'GET') headers['X-XSRF-TOKEN'] = this.csrf;
    const result = await send(path, { ...options, headers });
    if (result.response) this.capture(result.response);
    return result;
  }
  async refreshCsrf() {
    const result = await this.request('/api/v1/auth/csrf');
    if (result.status !== 200) throw new Error(`CSRF HTTP ${result.status}`);
    this.csrf = JSON.parse(result.body).token;
  }
  async login(username) {
    await this.refreshCsrf();
    const result = await this.request('/api/v1/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (result.status !== 200) throw new Error(`登录 ${username} HTTP ${result.status}: ${result.body.slice(0, 120)}`);
    await this.refreshCsrf();
  }
}

async function pool(count, concurrency, task, progressLabel) {
  let next = 0, finished = 0;
  const results = new Array(count);
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, async () => {
    while (true) {
      const index = next++;
      if (index >= count) return;
      results[index] = await task(index);
      finished++;
      if (progressLabel && finished % 500 === 0) output({ event: progressLabel, finished, total: count });
    }
  }));
  return results;
}

function describe(name, results, seconds) {
  const statuses = {}, changed = { true: 0, false: 0, unknown: 0 };
  for (const result of results) {
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    changed[String(result.changed ?? 'unknown')]++;
  }
  const ms = results.filter(result => result.status !== 'NETWORK_ERROR').map(result => result.ms);
  output({ scenario: name, requests: results.length, seconds: Number(seconds.toFixed(1)),
    achievedRps: Number((results.length / seconds).toFixed(1)), statuses, changed,
    p50Ms: percentile(ms, .5), p95Ms: percentile(ms, .95), p99Ms: percentile(ms, .99) });
  const measured = results.filter(result => result.timing);
  if (measured.length) {
    const stages = {};
    for (const stage of Object.keys(measured[0].timing)) {
      const values = measured.map(result => result.timing[stage]);
      stages[stage] = { avgMs: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)),
        p50Ms: percentile(values, .5), p95Ms: percentile(values, .95) };
    }
    const outside = measured.map(result => Math.max(0, result.ms - result.timing.controller));
    output({ event: 'server-timing', scenario: name, samples: measured.length, stages,
      outsideController: { avgMs: Number((outside.reduce((a, b) => a + b, 0) / outside.length).toFixed(2)),
        p50Ms: percentile(outside, .5), p95Ms: percentile(outside, .95) } });
  }
}

function parseTiming(header) {
  if (!header) return null;
  const entries = header.split(',').map(part => /^\s*([A-Za-z]+);dur=([\d.]+)\s*$/.exec(part));
  if (entries.some(entry => !entry)) return null;
  return Object.fromEntries(entries.map(entry => [entry[1], Number(entry[2])]));
}

function describeBurstQps(views, likes, seconds) {
  const perSecond = Array.from({ length: Math.ceil(seconds) }, (_, second) => ({ second, views: 0, likes: 0 }));
  for (const result of views) perSecond[Math.floor(result.completedAtMs / 1000)].views++;
  for (const result of likes) perSecond[Math.floor(result.completedAtMs / 1000)].likes++;
  output({ event: 'burst-qps', users, maxInFlightUsers: burstConcurrency,
    totalRequests: views.length + likes.length, seconds: Number(seconds.toFixed(1)),
    averageQps: Number(((views.length + likes.length) / seconds).toFixed(1)),
    peakOneSecondQps: Math.max(...perSecond.map(bucket => bucket.views + bucket.likes)),
    perSecond: perSecond.map(bucket => ({ ...bucket, total: bucket.views + bucket.likes })) });
}

async function main() {
  const health = await send('/api/v1/health');
  if (health.status !== 200) throw new Error('压测服务未就绪');
  const sessions = new Array(users);
  const setupStart = performance.now();
  await pool(users, loginConcurrency, async index => {
    // 登录需要 Argon2 验证并在 Redis 写入 Session。它属于压测准备阶段，
    // 偶发超时重试可避免把登录瓶颈误记为文章指标接口失败。
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const session = new Session();
        await session.login(`metric-user-${index + 1}`);
        sessions[index] = session;
        return;
      } catch (error) {
        if (attempt === 4) throw error;
        await sleep(500 * attempt);
      }
    }
  }, 'sessions-ready');
  output({ event: 'setup-complete', users, seconds: Number(((performance.now() - setupStart) / 1000).toFixed(1)) });

  const viewResults = new Array(users), likeResults = new Array(users);
  const burstStart = performance.now();
  output({ event: 'burst-start', users, maxInFlightUsers: burstConcurrency });
  await pool(users, burstConcurrency, async index => {
    const session = sessions[index];
    const view = await session.request('/api/v1/articles/perf-article-1/views', {
      method: 'POST', headers: { 'Idempotency-Key': randomUUID(), ...(timingEnabled ? { 'X-Perf-Timing': '1' } : {}) },
    });
    viewResults[index] = { status: view.status, ms: view.ms,
      completedAtMs: performance.now() - burstStart,
      timing: parseTiming(view.response?.headers.get('server-timing')),
      changed: view.status === 202 ? JSON.parse(view.body).changed : undefined };
    const like = await session.request('/api/v1/articles/perf-article-1/like', { method: 'PUT',
      headers: timingEnabled ? { 'X-Perf-Timing': '1' } : {} });
    likeResults[index] = { status: like.status, ms: like.ms,
      completedAtMs: performance.now() - burstStart,
      timing: parseTiming(like.response?.headers.get('server-timing')),
      changed: like.status === 200 ? JSON.parse(like.body).changed : undefined };
  }, 'users-finished');
  const burstSeconds = (performance.now() - burstStart) / 1000;
  describe('article-view', viewResults, burstSeconds);
  describe('article-like', likeResults, burstSeconds);
  describeBurstQps(viewResults, likeResults, burstSeconds);

  const duplicateStart = performance.now();
  const duplicates = await pool(100, 50, async () => {
    const result = await sessions[0].request('/api/v1/articles/perf-article-1/like', { method: 'PUT' });
    return { status: result.status, ms: result.ms,
      changed: result.status === 200 ? JSON.parse(result.body).changed : undefined };
  });
  describe('same-user-duplicate-like', duplicates, (performance.now() - duplicateStart) / 1000);
  output({ event: 'burst-complete', expectedViews: viewResults.filter(x => x.status === 202 && x.changed).length,
    expectedLikes: likeResults.filter(x => x.status === 200 && x.changed).length,
    duplicateAccepts: duplicates.filter(x => x.status === 200 && x.changed).length });

  if (pauseSeconds > 0) {
    output({ event: 'pause-before-drain', seconds: pauseSeconds, instruction: '可在此时重启 air-perf-app-1' });
    await sleep(pauseSeconds * 1000);
  }
  for (let attempt = 0; attempt < 180; attempt++) {
    const result = await sessions[0].request('/api/v1/articles/perf-article-1/stats');
    if (result.status === 200) {
      const stats = JSON.parse(result.body);
      if (stats.viewCount === users && stats.likeCount === users) {
        output({ event: 'stats-converged', attempts: attempt + 1, stats });
        return;
      }
      if (attempt % 10 === 0) output({ event: 'stats-wait', attempt, stats });
    } else if (attempt % 10 === 0) output({ event: 'stats-http', attempt, status: result.status });
    await sleep(1_000);
  }
  throw new Error('文章统计在 180 秒内没有达到预期值');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
