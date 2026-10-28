import { readFileSync } from 'node:fs';
const prefixes = process.argv.slice(2);
if (!prefixes.length) throw new Error('用法: node perf/summarize-metric-experiments.mjs target/label [...]');
const read = path => readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
for (const prefix of prefixes) {
  const events = read(`${prefix}.jsonl`), publisher = read(`${prefix}-publisher-summary.jsonl`)[0];
  const consumer = read(`${prefix}-consumer-summary.jsonl`)[0];
  const start = events.find(e => e.event === 'burst-start'), drained = events.find(e => e.event === 'pipeline-drained');
  const batches = read(`${prefix}-consumer.jsonl`).flatMap(e => e.samples)
    .filter(s => s.startedAtEpochMs >= start.atEpochMs && s.startedAtEpochMs <= drained.atEpochMs);
  const publishBatches = read(`${prefix}-publisher.jsonl`)
    .filter(s => s.startedAtEpochMs >= start.atEpochMs && s.startedAtEpochMs <= drained.atEpochMs);
  const result = events.find(e => e.event === 'comparison-result');
  const timing = events.find(e => e.event === 'comparison-timing');
  const waits = events.find(e => e.event === 'wait-summary');
  console.log(JSON.stringify({ prefix, ...result,
    drainSeconds: (drained.atEpochMs - start.atEpochMs) / 1000,
    lastConsumerAckSeconds: (Math.max(...batches.map(s => s.endedAtEpochMs)) - start.atEpochMs) / 1000,
    lastPublisherEndSeconds: (Math.max(...publishBatches.map(s => s.endedAtEpochMs)) - start.atEpochMs) / 1000,
    publishingSpanSeconds: publisher.publishingSpanSeconds, publisherBatches: publisher.batches,
    publisherTurns: publisher.turns, withinTurnGapMs: publisher.meanWithinTurnGapMs,
    betweenTurnGapMs: publisher.meanBetweenTurnGapMs, consumerBatches: consumer.batches,
    consumerReceived: consumer.received, consumerApplied: consumer.applied,
    consumerCycleTotalMs: consumer.stages.cycleMs.totalMs,
    consumerStatsSqlTotalMs: consumer.stages.statsSqlMs.totalMs,
    consumerCacheTotalMs: consumer.stages.cacheMs.totalMs, cacheArticles: consumer.cacheArticles,
    cacheDeleteCalls: consumer.cacheDeleteCalls ?? null, statsSqlCalls: consumer.statsSqlCalls ?? null,
    consumerEventAcquireTotalMs: consumer.stages.eventAcquireMs.totalMs,
    consumerApplyAcquireTotalMs: consumer.stages.applyAcquireMs.totalMs,
    consumerProcessedSqlTotalMs: consumer.stages.processedSqlMs.totalMs,
    consumerAckTotalMs: consumer.stages.ackMs.totalMs,
    consumerCommitTotalMs: consumer.stages.commitApproxMs.totalMs,
    httpAcquirePreAvgMs: timing.stages.dbAcquirePre.avgMs,
    httpAcquireControllerAvgMs: timing.stages.dbAcquireController.avgMs,
    httpCommitAvgMs: timing.stages.commitApprox.avgMs,
    maxOutboxPending: waits.maxOutboxPending, maxQueueReady: waits.maxQueueReady,
    maxPoolPending: waits.maxPoolPending, maxDbLockWait: waits.maxDbLockWait,
    observedDbWaitEvents: waits.observedDbWaitEvents,
    fairness: events.find(e => e.event === 'article-fairness-summary') ?? null,
    validation: JSON.parse(readFileSync(`${prefix}-validation.json`, 'utf8').trim()) }));
}
