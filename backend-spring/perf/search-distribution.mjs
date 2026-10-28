// 在隔离压测栈比较关键词分布；当前搜索没有 Redis 缓存，命中率只是模拟值。
// 仅请求本机 /api/v1/search，不读取真实用户查询，也不写入任何内容。
import { performance } from 'node:perf_hooks';

const base = process.env.PERF_BASE_URL ?? 'http://127.0.0.1:18081';
const stageSeconds = Number(process.env.PERF_STAGE_SECONDS ?? 45);
const rate = Number(process.env.PERF_SEARCH_RPS ?? 400);
const cacheTtlMs = 30_000;
const maxPending = 200;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = value => console.log(JSON.stringify(value));

if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('只允许请求本机压测端口');
if (!Number.isFinite(stageSeconds) || stageSeconds < 10 || stageSeconds > 600)
  throw new Error('PERF_STAGE_SECONDS 必须介于 10 和 600');
if (!Number.isInteger(rate) || rate < 1 || rate > 2000)
  throw new Error('PERF_SEARCH_RPS 必须介于 1 和 2000');

function percentile(values, p) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return Number(ordered[Math.ceil(p * ordered.length) - 1].toFixed(1));
}

function chooseQuery(pattern, index) {
  if (pattern === 'hot') {
    return { query: index % 2 ? 'Spring' : '不存在的词', group: 'hot' };
  }
  if (pattern === 'mixed') {
    const slot = index % 5;
    if (slot === 0) return { query: 'Spring', group: 'hot' };
    if (slot <= 2) {
      // 2000 个有效 ID 构成长尾词池，每个词在一档测试中只被重复数次。
      const n = ((Math.floor(index / 5) * 37 + slot) % 2000) + 1;
      return { query: `perf-article-${n}`, group: 'tail' };
    }
    return { query: `missing-mixed-${index}`, group: 'unique' };
  }
  if (index % 20 === 0) return { query: 'Spring', group: 'hot' };
  return { query: `missing-unique-${index}`, group: 'unique' };
}

async function request(query) {
  const started = performance.now();
  try {
    const url = `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=ALL&page=0&size=10`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    await response.text();
    return { status: response.status, ms: performance.now() - started };
  } catch (error) {
    return { status: 'NETWORK_ERROR', ms: performance.now() - started, error: String(error) };
  }
}

async function stage(pattern, requestedRps) {
  const pending = new Set(), responses = [], groups = new Map();
  const distinct = new Set(), expiryByKey = new Map();
  let scheduled = 0, dropped = 0, theoreticalHits = 0, repeats = 0;
  const started = performance.now(), deadline = started + stageSeconds * 1000;
  output({ event: 'stage-start', pattern, requestedRps, durationSeconds: stageSeconds });

  while (performance.now() < deadline) {
    const due = Math.floor((performance.now() - started) * requestedRps / 1000);
    while (scheduled < due) {
      const index = scheduled++;
      if (pending.size >= maxPending) { dropped++; continue; }
      const { query, group } = chooseQuery(pattern, index);
      const key = `${query}|ALL|0|10`;
      const now = performance.now();
      if (distinct.has(key)) repeats++;
      distinct.add(key);
      if ((expiryByKey.get(key) ?? 0) > now) theoreticalHits++;
      else expiryByKey.set(key, now + cacheTtlMs);
      groups.set(group, (groups.get(group) ?? 0) + 1);

      const task = request(query).then(result => responses.push({ ...result, group }))
        .finally(() => pending.delete(task));
      pending.add(task);
    }
    await sleep(20);
  }
  await Promise.allSettled([...pending]);
  const elapsedSeconds = (performance.now() - started) / 1000;
  const statuses = {};
  for (const response of responses) statuses[response.status] = (statuses[response.status] ?? 0) + 1;
  const timings = responses.filter(response => response.status !== 'NETWORK_ERROR').map(response => response.ms);
  const groupP95Ms = {};
  for (const group of groups.keys()) {
    groupP95Ms[group] = percentile(responses.filter(response => response.group === group && response.status === 200)
      .map(response => response.ms), .95);
  }
  output({ pattern, requestedRps, elapsedSeconds: Number(elapsedSeconds.toFixed(1)),
    achievedRps: Number((responses.length / elapsedSeconds).toFixed(1)), requests: responses.length,
    droppedByGenerator: dropped, statuses, groups: Object.fromEntries(groups), distinctKeys: distinct.size,
    repeatedRequests: repeats, theoreticalCacheHits30s: theoreticalHits,
    theoreticalHitRate30s: Number((theoreticalHits / responses.length).toFixed(4)),
    p50Ms: percentile(timings, .5), p95Ms: percentile(timings, .95), p99Ms: percentile(timings, .99),
    groupP95Ms });
}

async function main() {
  const health = await fetch(`${base}/api/v1/health`);
  if (health.status !== 200) throw new Error(`隔离服务未就绪: ${health.status}`);
  for (const pattern of ['hot', 'mixed', 'mostly-unique']) await stage(pattern, rate);
  await stage('mixed', Math.round(rate * 1.5));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
