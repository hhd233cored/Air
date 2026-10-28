// 将压测客户端时间戳与发布器批次日志对齐；不从每批 p95 反推全体事件 p95。
import { readFileSync } from 'node:fs';

const [batchFile, ...scenarioFiles] = process.argv.slice(2);
if (!batchFile || !scenarioFiles.length) {
  throw new Error('用法: node perf/summarize-publisher.mjs batches.jsonl scenario.jsonl [...]');
}
const read = path => readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const batches = read(batchFile);
const round = value => Number(value.toFixed(3));
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? round(sorted[Math.ceil(sorted.length * p) - 1]) : null;
};

function summarize(selected) {
  const sum = key => round(selected.reduce((total, batch) => total + (batch[key] ?? 0), 0));
  const marked = sum('marked');
  const cycle = sum('cycleMs');
  const stages = {};
  for (const key of ['claimMs', 'sendMs', 'confirmWaitMs', 'markMs', 'deferMs', 'otherMs']) {
    stages[key] = { totalMs: sum(key), cycleSharePct: cycle ? round(sum(key) / cycle * 100) : 0 };
  }
  const full = selected.filter(batch => batch.claimed === 200);
  const fullBatch = {};
  for (const key of ['claimMs', 'sendMs', 'confirmWaitMs', 'markMs', 'cycleMs']) {
    fullBatch[key] = { p50Ms: percentile(full.map(batch => batch[key]), .5),
      p95Ms: percentile(full.map(batch => batch[key]), .95) };
  }
  const confirmations = selected.reduce((sum, batch) => sum + batch.confirmLatencyPerEvent.samples, 0);
  const markCalls = selected.reduce((sum, batch) => sum + (batch.markCalls ?? batch.markPerEvent?.samples ?? 0), 0);
  const markRequested = selected.reduce((sum, batch) => sum + (batch.markRequested ?? batch.markPerEvent?.samples ?? 0), 0);
  const modes = [...new Set(selected.map(batch => batch.markMode ?? 'individual'))];
  const gaps = selected.slice(1).map((batch, index) =>
    batch.startedAtEpochMs - selected[index].endedAtEpochMs);
  const withinTurnGaps = [], betweenTurnGaps = [];
  selected.slice(1).forEach((batch, index) => {
    if (batch.turnId === undefined) return;
    (batch.turnId === selected[index].turnId ? withinTurnGaps : betweenTurnGaps).push(gaps[index]);
  });
  const mean = values => values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const sendNested = {};
  for (const key of ['prepareMs', 'payloadMs', 'templateMs', 'convertMs', 'propertiesMs', 'rabbitAfterConvertMs']) {
    const observed = selected.some(batch => batch[key] !== undefined);
    sendNested[key] = { totalMs: observed ? sum(key) : null,
      perSentEventMs: observed && sum('sent') ? round(sum(key) / sum('sent')) : null,
      fullBatchP95Ms: percentile(full.filter(batch => batch[key] !== undefined).map(batch => batch[key]), .95) };
  }
  const afterReturn = selected.reduce((n, batch) => n + (batch.confirmAfterSendReturnPerEvent?.samples ?? 0), 0);
  return { batches: selected.length, fullBatches: full.length, claimed: sum('claimed'),
    sent: sum('sent'), confirmed: sum('confirmed'), marked, failures: sum('failures'),
    cycleTotalMs: cycle, stages, fullBatch,
    sendNested, convertSamples: sum('convertSamples'), confirmedBeforeSendReturn: sum('confirmedBeforeSendReturn'),
    confirmAfterSendReturnMeanMs: afterReturn ? round(selected.reduce((n, batch) => n
      + (batch.confirmAfterSendReturnPerEvent?.avgMs ?? 0) * (batch.confirmAfterSendReturnPerEvent?.samples ?? 0), 0) / afterReturn) : null,
    turns: selected.some(batch => batch.turnId !== undefined) ? new Set(selected.map(batch => batch.turnId)).size : null,
    withinTurnGaps: withinTurnGaps.length, betweenTurnGaps: betweenTurnGaps.length,
    meanWithinTurnGapMs: mean(withinTurnGaps), meanBetweenTurnGapMs: mean(betweenTurnGaps),
    claimAcquireTotalMs: sum('claimAcquireMs'), markAcquireTotalMs: sum('markAcquireMs'),
    markModes: modes, markCalls, markRequested,
    markAmortizedPerEventMs: markRequested ? round(sum('markMs') / markRequested) : null,
    markMeanPerCallMs: markCalls ? round(sum('markMs') / markCalls) : null,
    markMaxPerCallMs: Math.max(0, ...selected.map(batch => (batch.markBatch ?? batch.markPerEvent)?.maxMs ?? 0)),
    confirmMeanLatencyMs: confirmations ? round(selected.reduce((total, batch) =>
      total + (batch.confirmLatencyPerEvent.avgMs ?? 0) * batch.confirmLatencyPerEvent.samples, 0)
      / confirmations) : null,
    confirmMaxLatencyMs: Math.max(0, ...selected.map(batch => batch.confirmLatencyPerEvent.maxMs ?? 0)),
    publishingSpanSeconds: selected.length ? round((selected.at(-1).endedAtEpochMs
      - selected[0].startedAtEpochMs) / 1000) : 0,
    meanGapBetweenBatchesMs: gaps.length ? round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null };
}

for (const file of scenarioFiles) {
  const events = read(file);
  const start = events.find(event => event.event === 'burst-start');
  const end = events.find(event => event.event === 'burst-end');
  const drained = events.find(event => event.event === 'pipeline-drained');
  if (!start || !end || !drained) throw new Error(`${file} 缺少完整的突发与排空时间戳`);
  const selected = batches.filter(batch => batch.startedAtEpochMs >= start.atEpochMs
    && batch.startedAtEpochMs <= drained.atEpochMs).sort((a, b) => a.startedAtEpochMs - b.startedAtEpochMs);
  console.log(JSON.stringify({ event: 'publisher-summary', scenario: start.scenario, ...summarize(selected) }));
  for (const [phase, group] of [
    ['burst-or-overlap', selected.filter(batch => batch.startedAtEpochMs < end.atEpochMs)],
    ['after-burst', selected.filter(batch => batch.startedAtEpochMs >= end.atEpochMs)]]) {
    console.log(JSON.stringify({ event: 'publisher-phase-summary', scenario: start.scenario,
      phase, ...summarize(group) }));
  }
}
