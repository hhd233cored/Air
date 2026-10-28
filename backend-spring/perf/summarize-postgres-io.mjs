import { readFileSync } from 'node:fs';
const round = n => Number(n.toFixed(3));
function delta(before, after) {
  if (before.stats_reset !== after.stats_reset) throw new Error('Statistics reset during measurement');
  return Object.fromEntries(Object.entries(after).filter(([,v]) => typeof v === 'number')
    .map(([key,value]) => {
      const difference = value - (before[key] ?? 0);
      if (difference < -0.001) throw new Error('Counter decreased: ' + key);
      return [key, round(difference)];
    }));
}
const ioKey = r => [r.backend_type,r.object,r.context].join('/');
for (const prefix of process.argv.slice(2)) {
  const rows = readFileSync(prefix + '.jsonl','utf8').trim().split(/\r?\n/).map(JSON.parse);
  const snapshots = rows.filter(row => row.event === 'postgres-snapshot');
  const before = snapshots.find(row => row.phase === 'before-burst');
  if (!before) throw new Error('Missing baseline: ' + prefix);
  for (const after of snapshots.filter(row => row.phase !== 'before-burst')) {
    const io = after.io.map(row => ({backendType:row.backend_type,object:row.object,context:row.context,
      ...delta(before.io.find(b => ioKey(b) === ioKey(row)) ?? {},row)}));
    const statements = after.statements.map(row => ({category:row.category,
      ...delta(before.statements.find(b => b.category === row.category) ?? {},row)}));
    const walIO = io.filter(row => row.object === 'wal');
    const sum = field => walIO.reduce((total,row) => total + (row[field] ?? 0),0);
    const commits = statements.find(row => row.category === 'commit');
    console.log(JSON.stringify({event:'postgres-delta',prefix,phase:after.phase,
      baselineStartedAtEpochMs:before.startedAtEpochMs,endEndedAtEpochMs:after.endedAtEpochMs,
      seconds:round((after.endedAtEpochMs-before.startedAtEpochMs)/1000),
      wal:delta(before.wal,after.wal),database:delta(before.database,after.database),
      checkpoints:delta(before.checkpoints,after.checkpoints),
      statementInfo:delta(before.statementInfo,after.statementInfo),io,statements,
      // Prepared COMMIT coverage is incomplete here. This utility timing is NOT durable commit latency.
      commitUtilityAvgMs:commits?.calls ? round(commits.exec_ms/commits.calls) : null,
      commitUtilityCalls:commits?.calls ?? 0,
      walWrites:sum('writes'),walWriteMs:round(sum('write_time')),
      walWriteAvgMs:sum('writes') ? round(sum('write_time')/sum('writes')) : null,
      walFsyncs:sum('fsyncs'),walFsyncMs:round(sum('fsync_time')),
      walFsyncAvgMs:sum('fsyncs') ? round(sum('fsync_time')/sum('fsyncs')) : null}));
  }
}
