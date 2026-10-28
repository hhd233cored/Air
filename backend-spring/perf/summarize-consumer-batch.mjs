// 分位数单位是消费批次；摊销值是累计执行时间 / 收到消息数，不是单条延迟。
import { readFileSync } from 'node:fs';
const [sampleFile, ...scenarioFiles] = process.argv.slice(2);
if (!sampleFile || !scenarioFiles.length) throw new Error('用法: node perf/summarize-consumer-batch.mjs samples.jsonl scenario.jsonl [...]');
const read = path => readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const samples = read(sampleFile).flatMap(row => row.samples).filter(row => row.sampleKind === 'batch');
const round = n => Number(n.toFixed(3));
const sum = rows => rows.reduce((a, b) => a + b, 0);
const distribution = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sum(sorted);
  return { samples: values.length, totalMs: round(total), avgMs: values.length ? round(total / values.length) : null,
    p50Ms: sorted[Math.ceil(sorted.length * .5) - 1] ?? null,
    p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, maxMs: sorted.at(-1) ?? null };
};
for (const path of scenarioFiles) {
  const events = read(path);
  const start = events.find(e => e.event === 'burst-start');
  const end = events.find(e => e.event === 'burst-end');
  const drained = events.find(e => e.event === 'pipeline-drained');
  if (!start || !end || !drained) throw new Error(`${path} 缺少完整时间轴`);
  const selected = samples.filter(s => s.startedAtEpochMs >= start.atEpochMs && s.startedAtEpochMs <= drained.atEpochMs);
  for (const [phase, rows] of [['all', selected], ['burst-or-overlap', selected.filter(s => s.startedAtEpochMs < end.atEpochMs)],
    ['after-burst', selected.filter(s => s.startedAtEpochMs >= end.atEpochMs)]]) {
    if (!rows.length) continue;
    const counts = {};
    for (const key of ['received', 'applied', 'duplicate', 'rejected', 'requeued', 'viewEvents', 'likeEvents',
      'commitSamples', 'cacheArticles', 'cacheEvictionFailures']) counts[key] = sum(rows.map(s => s[key]));
    for (const key of ['cacheDeleteCalls', 'cacheEvictionFailedArticles', 'statsSqlCalls']) {
      counts[key] = rows.every(s => Number.isFinite(s[key])) ? sum(rows.map(s => s[key])) : null;
    }
    const stages = {};
    const cycleTotal = sum(rows.map(s => s.cycleMs));
    for (const key of ['cycleMs', 'decodeMs', 'eventMs', 'eventAcquireMs', 'applyCallMs', 'applyAcquireMs',
      'applyBodyMs', 'processedSqlMs', 'statsSqlMs', 'commitApproxMs', 'applyOtherMs', 'cacheMs', 'ackMs', 'otherMs']) {
      stages[key] = { ...distribution(rows.map(s => s[key])),
        amortizedMsPerReceivedMessage: round(sum(rows.map(s => s[key])) / counts.received),
        cycleSharePct: round(sum(rows.map(s => s[key])) / cycleTotal * 100) };
    }
    const transactions = rows.reduce((a, s) => { a[s.transactionCompletion] = (a[s.transactionCompletion] ?? 0) + 1; return a; }, {});
    console.log(JSON.stringify({ event: 'consumer-batch-summary', scenario: start.scenario, phase,
      batches: rows.length, meanBatchSize: round(counts.received / rows.length),
      minBatchSize: Math.min(...rows.map(s => s.received)), maxBatchSize: Math.max(...rows.map(s => s.received)),
      ...counts, transactions, consumingSpanSeconds: round((Math.max(...rows.map(s => s.endedAtEpochMs))
        - Math.min(...rows.map(s => s.startedAtEpochMs))) / 1000), stages }));
  }
}
