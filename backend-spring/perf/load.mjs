// 无外部依赖的首轮压测工具；仅向 PERF_BASE_URL 指向的隔离服务发送请求。
// 用法：设置 PERF_ADMIN_PASSWORD、PERF_USER_PASSWORD 后执行 node perf/load.mjs。
import { performance } from 'node:perf_hooks';

const base = process.env.PERF_BASE_URL ?? 'http://127.0.0.1:18081';
const seconds = Number(process.env.PERF_STAGE_SECONDS ?? 30);
const timeoutMs = 15_000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = value => console.log(JSON.stringify(value));

if (!Number.isFinite(seconds) || seconds < 5 || seconds > 600) throw new Error('PERF_STAGE_SECONDS 必须介于 5 和 600');
if (!base.startsWith('http://127.0.0.1:') && !base.startsWith('http://localhost:'))
  throw new Error('首轮脚本只允许请求本机压测端口');

function percentile(values, p) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return Number(ordered[Math.ceil(p * ordered.length) - 1].toFixed(1));
}

async function send(path, options = {}) {
  const started = performance.now();
  try {
    const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.text();
    return { status: response.status, ms: performance.now() - started, response, body };
  } catch (error) {
    return { status: 'NETWORK_ERROR', ms: performance.now() - started, error: String(error) };
  }
}

function describe(name, requestedRate, elapsedMs, results, dropped = 0) {
  const statuses = {};
  for (const result of results) statuses[result.status] = (statuses[result.status] ?? 0) + 1;
  const latencies = results.filter(result => result.status !== 'NETWORK_ERROR').map(result => result.ms);
  output({ scenario: name, requestedRps: requestedRate, elapsedSeconds: Number((elapsedMs / 1000).toFixed(1)),
    achievedRps: Number((results.length / (elapsedMs / 1000)).toFixed(1)), requests: results.length,
    droppedByGenerator: dropped, statuses, p50Ms: percentile(latencies, .5),
    p95Ms: percentile(latencies, .95), p99Ms: percentile(latencies, .99),
    maxMs: latencies.length ? Number(Math.max(...latencies).toFixed(1)) : null });
}

// 按目标 RPS 开环发请求；限制本机并发，避免压测器失控掩盖被测服务的表现。
async function stage(name, rps, choose, duration = seconds) {
  const results = [], pending = new Set();
  let scheduled = 0, dropped = 0;
  const started = performance.now(), deadline = started + duration * 1000;
  output({ event: 'stage-start', scenario: name, requestedRps: rps, durationSeconds: duration });
  while (performance.now() < deadline) {
    const due = Math.floor((performance.now() - started) * rps / 1000);
    while (scheduled < due) {
      const index = scheduled++;
      if (pending.size >= 200) { dropped++; continue; }
      const { path, options } = choose(index);
      // 不留存响应正文或 Header，长时间测试也只保存少量统计字段。
      const task = send(path, options).then(result => results.push({ status: result.status, ms: result.ms }))
        .finally(() => pending.delete(task));
      pending.add(task);
    }
    await sleep(20);
  }
  await Promise.allSettled([...pending]);
  describe(name, rps, performance.now() - started, results, dropped);
  return results;
}

class Session {
  constructor() { this.cookies = new Map(); this.csrf = null; }
  get cookie() { return [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '); }
  capture(response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
  async request(path, options = {}) {
    const headers = { ...(options.headers ?? {}), Cookie: this.cookie };
    if (options.method && options.method !== 'GET' && this.csrf) headers['X-XSRF-TOKEN'] = this.csrf;
    const result = await send(path, { ...options, headers });
    if (result.response) this.capture(result.response);
    return result;
  }
  async refreshCsrf() {
    const result = await this.request('/api/v1/auth/csrf');
    if (result.status !== 200) throw new Error(`CSRF 失败: ${result.status}`);
    this.csrf = JSON.parse(result.body).token;
  }
  async login(username, password) {
    await this.refreshCsrf();
    const result = await this.request('/api/v1/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (result.status === 200) await this.refreshCsrf();
    return result.status;
  }
}

function wavBlob() {
  // 有效的 1 MiB 单声道 WAV，内容为静音；不复制任何用户音乐文件。
  const pcmBytes = 1_048_576;
  const buffer = Buffer.alloc(44 + pcmBytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16_000, 24); buffer.writeUInt32LE(32_000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(pcmBytes, 40);
  return new Blob([buffer], { type: 'audio/wav' });
}

const readPaths = index => [
  `/api/v1/articles?page=${index % 20}&size=10`,
  `/api/v1/articles/perf-article-${index % 2000 + 1}`,
  `/api/v1/chatter?page=${index % 20}&size=10`,
  `/api/v1/chatter/perf-chatter-${index % 2000 + 1}`,
  `/api/v1/articles/perf-article-${index % 100 + 1}/comments?page=0&size=20`,
  '/api/v1/guestbook/messages?page=0&size=20'
];
const readPath = index => readPaths(index)[index % 6];
const searchPath = index => `/api/v1/search?q=${encodeURIComponent(index % 2 ? 'Spring' : '不存在的词')}&page=${index % 5}&size=10`;

async function ceiling(name, rates, choose) {
  for (const rps of rates) {
    const results = await stage(name, rps, index => ({ path: choose(index) }));
    const failures = results.filter(result => result.status !== 200).length;
    const p95 = percentile(results.filter(result => result.status === 200).map(result => result.ms), .95);
    if (failures || p95 === null || p95 > 500) {
      output({ event: 'ceiling-stop', scenario: name, requestedRps: rps, failures, p95Ms: p95 });
      break;
    }
  }
}

async function audioBurst(admin) {
  const audio = wavBlob(), started = performance.now();
  output({ event: 'stage-start', scenario: 'audio-burst', concurrent: 25, audioBytes: audio.size });
  const results = await Promise.all(Array.from({ length: 25 }, async (_, index) => {
    const body = new FormData();
    body.append('audio', audio, `perf-${index}.wav`);
    const result = await admin.request('/api/v1/admin/music/import-jobs', { method: 'POST', body });
    let id = null;
    if (result.status === 202) id = JSON.parse(result.body).id;
    return { status: result.status, ms: result.ms, id };
  }));
  describe('audio-burst', 0, performance.now() - started, results);
  const ids = results.map(result => result.id).filter(Boolean);
  let states = {};
  for (let round = 0; round < 90; round++) {
    const statusResults = await Promise.all(ids.map(id => admin.request(`/api/v1/admin/music/import-jobs/${id}`)));
    states = {};
    for (const result of statusResults) {
      const status = result.status === 200 ? JSON.parse(result.body).status : `HTTP_${result.status}`;
      states[status] = (states[status] ?? 0) + 1;
    }
    if ((states.SUCCEEDED ?? 0) + (states.FAILED ?? 0) === ids.length) break;
    await sleep(2_000);
  }
  output({ scenario: 'audio-drain', accepted: ids.length, finalStates: states,
    elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(1)) });
}

async function main() {
  const health = await send('/api/v1/health');
  if (health.status !== 200) throw new Error(`隔离服务未就绪: ${health.status}`);
  if (process.env.PERF_SCENARIO === 'smoke') {
    for (const path of ['/api/v1/articles?page=0&size=10',
      '/api/v1/articles/perf-article-1', '/api/v1/search?q=Spring&page=0&size=10']) {
      const result = await send(path);
      output({ scenario: 'smoke', path, status: result.status, ms: Number(result.ms.toFixed(1)) });
      if (result.status !== 200) throw new Error(`基础读取失败: ${path}`);
    }
    return;
  }
  if (process.env.PERF_SCENARIO === 'read-ceiling') {
    await ceiling('public-read-ceiling', [200, 400, 800], readPath);
    return;
  }
  if (process.env.PERF_SCENARIO === 'search-ceiling') {
    await ceiling('search-ceiling', [40, 80, 160], searchPath);
    return;
  }
  if (process.env.PERF_SCENARIO === 'search-refine') {
    await ceiling('search-refine', [100, 120, 140], searchPath);
    return;
  }
  if (process.env.PERF_SCENARIO === 'search-repeat160') {
    await stage('search-repeat160-a', 160, index => ({ path: searchPath(index) }));
    await stage('search-repeat160-b', 160, index => ({ path: searchPath(index) }));
    return;
  }
  if (process.env.PERF_SCENARIO === 'search-high') {
    await ceiling('search-high', [200, 240, 320, 400], searchPath);
    return;
  }
  if (process.env.PERF_SCENARIO === 'mixed-soak') {
    if (!process.env.PERF_USER_PASSWORD) throw new Error('缺少 PERF_USER_PASSWORD');
    const session = new Session();
    if (await session.login('perf_user', process.env.PERF_USER_PASSWORD) !== 200)
      throw new Error('混合压测账号登录失败');
    const duration = Number(process.env.PERF_SOAK_SECONDS ?? 180);
    await stage('mixed-soak', 200, index => {
      const slot = index % 20;
      if (slot < 12) return { path: readPath(index) };
      if (slot < 17) return { path: searchPath(index) };
      return { path: '/api/v1/auth/me', options: { headers: { Cookie: session.cookie } } };
    }, duration);
    return;
  }
  const admin = new Session(), user = new Session();
  if (!process.env.PERF_ADMIN_PASSWORD || !process.env.PERF_USER_PASSWORD)
    throw new Error('缺少 PERF_ADMIN_PASSWORD 或 PERF_USER_PASSWORD');
  const adminLogin = await admin.login('perf_admin', process.env.PERF_ADMIN_PASSWORD);
  const userLogin = await user.login('perf_user', process.env.PERF_USER_PASSWORD);
  if (adminLogin !== 200 || userLogin !== 200) throw new Error(`压测账号登录失败: admin=${adminLogin}, user=${userLogin}`);

  for (const rps of [5, 20, 50, 100])
    await stage('public-read-mix', rps, index => ({ path: readPath(index) }));
  for (const rps of [1, 5, 10, 20])
    await stage('search', rps, index => ({ path: searchPath(index) }));
  for (const rps of [10, 30, 60])
    await stage('auth-me', rps, () => ({ path: '/api/v1/auth/me', options: { headers: { Cookie: user.cookie } } }));
  await audioBurst(admin);

  // 默认限流单独验证：连续登录的前 5 次成功，第 6 次开始返回 429。
  const loginStatuses = [];
  for (let index = 0; index < 7; index++) {
    const attempt = new Session();
    loginStatuses.push(await attempt.login('perf_user', process.env.PERF_USER_PASSWORD));
  }
  output({ scenario: 'default-login-rate-limit', statuses: loginStatuses });

  const commentStatuses = [];
  for (let index = 0; index < 12; index++) {
    const result = await user.request('/api/v1/articles/perf-article-1/comments', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `虚构的压测写入 ${index}`, parentId: null }) });
    commentStatuses.push(result.status);
  }
  output({ scenario: 'default-comment-rate-limit', statuses: commentStatuses });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
