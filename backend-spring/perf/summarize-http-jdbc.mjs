import { readFileSync } from 'node:fs';
const prefixes = process.argv.slice(2);
if (!prefixes.length) throw new Error('用法: node perf/summarize-http-jdbc.mjs target/label [...]');
const read = path => readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const round = value => Number(value.toFixed(3));
for (const prefix of prefixes) {
  const rows = read(`${prefix}.jsonl`);
  const result = rows.find(row => row.event === 'comparison-result');
  const timing = rows.find(row => row.event === 'comparison-timing');
  const counts = rows.find(row => row.event === 'comparison-jdbc-counts');
  const start = rows.find(row => row.event === 'burst-start');
  const end = rows.find(row => row.event === 'burst-end');
  const config = JSON.parse(readFileSync(`${prefix}-config.json`, 'utf8').trim());
  const jdbcSeconds = rows.filter(row => row.event === 'jdbc-completed-second');
  const stages = {};
  for (const name of Object.keys(jdbcSeconds[0]?.stages ?? {})) {
    const totalMs = jdbcSeconds.reduce((sum, row) => sum + row.stages[name].totalMs, 0);
    stages[name] = { totalMs: round(totalMs), avgMs: round(totalMs / counts.samples),
      p50Ms: timing.stages[name].p50Ms, p95Ms: timing.stages[name].p95Ms,
      p99Ms: timing.stages[name].p99Ms, maxMs: timing.stages[name].maxMs };
  }
  const burstSeconds = (end.atEpochMs - start.atEpochMs) / 1000;
  console.log(JSON.stringify({ event: 'http-jdbc-summary', prefix, config, result,
    timingSamples: timing.samples, jdbcSamples: counts?.samples ?? 0, counts: counts?.counts ?? null,
    burstSeconds, occupancyEstimated: (counts?.samples ?? 0) !== result.requests, averageHttpLeases: stages.dbHold ? round(stages.dbHold.totalMs * result.requests / counts.samples / (burstSeconds * 1000)) : null,
    writeSharePct: stages.dbHold ? round(stages.dbHoldWrite.totalMs / stages.dbHold.totalMs * 100) : null,
    commitSharePct: stages.dbHold ? round(stages.jdbcCommit.totalMs / stages.dbHold.totalMs * 100) : null,
    stages,
    acquirePre: timing.stages.dbAcquirePre, acquireController: timing.stages.dbAcquireController,
    commitApprox: timing.stages.commitApprox,
    tomcatPreFilter: timing.stages.tomcatPreFilter ?? null,
    transport: rows.find(row => row.event === 'comparison-transport') ?? null,
    clientRuntime: rows.find(row => row.event === 'client-runtime') ?? null,
    operations: rows.filter(row => row.event === 'comparison-operation-timing'),
    waitSummary: rows.find(row => row.event === 'wait-summary') }));
  // 桶按请求完成时刻归属；同秒探针取最后一条。桶内指标不是 SQL 执行的精确发生区间。
  const acquireSeconds = rows.filter(row => row.event === 'connection-acquire-second');
  const waitSamples = rows.filter(row => row.event === 'wait-sample');
  const transportSeconds = rows.filter(row => row.event === 'http-transport-completed-second');
  for (const row of jdbcSeconds) {
    const acquire = acquireSeconds.find(sample => sample.secondStartEpochMs === row.secondStartEpochMs);
    const probes = waitSamples.filter(sample => sample.sampledAtEpochMs >= row.secondStartEpochMs
      && sample.sampledAtEpochMs < row.secondStartEpochMs + 1000);
    console.log(JSON.stringify({ event: 'http-jdbc-timeline', prefix,
      second: (row.secondStartEpochMs - start.atEpochMs) / 1000, secondStartEpochMs: row.secondStartEpochMs,
      requests: row.requests, stages: row.stages, acquire: acquire ?? null,
      transport: transportSeconds.find(sample=>sample.secondStartEpochMs === row.secondStartEpochMs) ?? null,
      waitSample: probes.at(-1) ?? null }));
  }
}
