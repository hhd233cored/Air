// 每条消息的原始样本用于重算分位数；SQL、借连接、提交是 applyCall 的子段，不重复相加。
import { readFileSync } from 'node:fs';

const [sampleFile, ...scenarioFiles] = process.argv.slice(2);
if (!sampleFile || !scenarioFiles.length) {
  throw new Error('用法: node perf/summarize-consumer.mjs consumer.jsonl scenario.jsonl [...]');
}
const read = path => readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const samples = read(sampleFile).flatMap(record => record.samples);
if (samples.some(sample => sample.sampleKind === 'batch')) {
  throw new Error('批次样本请使用 summarize-consumer-batch.mjs；不能将批次分位数当作单条延迟');
}
const round = value => Number(value.toFixed(3));
const sum = values => values.reduce((total, value) => total + value, 0);
const distribution = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return { samples: values.length, totalMs: round(sum(values)),
    avgMs: values.length ? round(sum(values) / values.length) : null,
    p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: sorted.at(-1) ?? null };
};
const counts = (rows, key) => rows.reduce((result, row) => {
  result[row[key]] = (result[row[key]] ?? 0) + 1;
  return result;
}, {});

function summarize(rows) {
  const cycleTotal = sum(rows.map(row => row.cycleMs));
  const stages = {};
  for (const key of ['decodeMs', 'eventMs', 'applyCallMs', 'cacheMs', 'ackMs', 'otherMs']) {
    stages[key] = { ...distribution(rows.map(row => row[key])),
      cycleSharePct: cycleTotal ? round(sum(rows.map(row => row[key])) / cycleTotal * 100) : 0 };
  }
  const nested = {};
  for (const key of ['eventAcquireMs', 'applyAcquireMs', 'applyBodyMs', 'processedSqlMs',
    'statsSqlMs', 'commitApproxMs', 'applyOtherMs']) {
    const valid = key === 'commitApproxMs' ? rows.filter(row => row.commitSamples > 0) : rows;
    nested[key] = distribution(valid.map(row => row[key]));
  }
  const cacheAttempts = rows.filter(row => row.cacheAttempted);
  return { samples: rows.length, outcomes: counts(rows, 'outcome'),
    transactions: counts(rows, 'transactionCompletion'),
    commitSamples: sum(rows.map(row => row.commitSamples)),
    cacheAttempts: cacheAttempts.length, cacheEvictionFailures: sum(rows.map(row => row.cacheEvictionFailures)),
    cacheAttemptTiming: distribution(cacheAttempts.map(row => row.cacheMs)),
    cycle: distribution(rows.map(row => row.cycleMs)), stages, nested,
    consumingSpanSeconds: rows.length ? round((Math.max(...rows.map(row => row.endedAtEpochMs))
      - Math.min(...rows.map(row => row.startedAtEpochMs))) / 1000) : 0 };
}

for (const path of scenarioFiles) {
  const events = read(path);
  const start = events.find(event => event.event === 'burst-start');
  const end = events.find(event => event.event === 'burst-end');
  const drained = events.find(event => event.event === 'pipeline-drained');
  if (!start || !end || !drained) throw new Error(`${path} 缺少完整的突发与排空时间戳`);
  const selected = samples.filter(sample => sample.startedAtEpochMs >= start.atEpochMs
    && sample.startedAtEpochMs <= drained.atEpochMs);
  for (const [phase, rows] of [
    ['all', selected],
    ['burst-or-overlap', selected.filter(sample => sample.startedAtEpochMs < end.atEpochMs)],
    ['after-burst', selected.filter(sample => sample.startedAtEpochMs >= end.atEpochMs)]]) {
    for (const metricType of ['ALL', 'VIEW', 'LIKE']) {
      const group = metricType === 'ALL' ? rows : rows.filter(row => row.metricType === metricType);
      if (!group.length) continue;
      console.log(JSON.stringify({ event: 'consumer-summary', scenario: start.scenario,
        phase, metricType, ...summarize(group) }));
    }
  }
}
