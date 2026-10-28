package org.airchord.backend.metrics;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 压测专用：一批发布的串行耗时与异步确认延迟分别记录。 */
final class ArticleMetricPublisherTiming {
    private static final ThreadLocal<Batch> CURRENT = new ThreadLocal<>();

    private ArticleMetricPublisherTiming() { }

    static Batch begin(boolean enabled) {
        if (!enabled) return null;
        Batch batch = new Batch();
        CURRENT.set(batch);
        return batch;
    }

    static void clear() { CURRENT.remove(); }

    static MarkJdbc currentMarkJdbc() {
        Batch batch = CURRENT.get();
        return batch != null && batch.phase == Phase.MARK ? batch.markJdbc : null;
    }

    static void connectionAcquire(long nanos) {
        Batch batch = CURRENT.get();
        if (batch == null) return;
        if (batch.phase == Phase.CLAIM) batch.claimAcquireNanos += nanos;
        else if (batch.phase == Phase.MARK) batch.markAcquireNanos += nanos;
    }

    enum Phase { CLAIM, SEND, CONFIRM, MARK, DEFER }

    static final class Batch {
        final long startedAtEpochMs = System.currentTimeMillis();
        final long startedNanos = System.nanoTime();
        Phase phase = Phase.CLAIM;
        long turnId;
        int batchIndex;
        int maxBatchesPerRun;
        int claimed;
        int sent;
        int confirmed;
        int marked;
        int markRequested;
        int failures;
        long claimNanos;
        long claimAcquireNanos;
        long sendNanos;
        long prepareNanos;
        long payloadNanos;
        long templateNanos;
        long convertNanos;
        long propertiesNanos;
        int convertSamples;
        int confirmedBeforeSendReturn;
        long confirmWaitNanos;
        long markNanos;
        long markStartedAtEpochMs;
        long markEndedAtEpochMs;
        long markAcquireNanos;
        final MarkJdbc markJdbc = new MarkJdbc();
        long deferNanos;
        final List<Long> confirmWaits = new ArrayList<>();
        final List<Long> confirmLatencies = new ArrayList<>();
        final List<Long> confirmAfterSendReturn = new ArrayList<>();
        final List<Long> markBatchDurations = new ArrayList<>();

        Map<String, Object> summary() {
            long elapsed = System.nanoTime() - startedNanos;
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("event", "publisher-batch");
            values.put("turnId", turnId);
            values.put("batchIndex", batchIndex);
            values.put("maxBatchesPerRun", maxBatchesPerRun);
            values.put("startedAtEpochMs", startedAtEpochMs);
            values.put("endedAtEpochMs", System.currentTimeMillis());
            values.put("claimed", claimed);
            values.put("sent", sent);
            values.put("confirmed", confirmed);
            values.put("marked", marked);
            values.put("failures", failures);
            values.put("cycleMs", millis(elapsed));
            values.put("claimMs", millis(claimNanos));
            values.put("claimAcquireMs", millis(claimAcquireNanos));
            values.put("sendMs", millis(sendNanos));
            values.put("prepareMs", millis(prepareNanos));
            values.put("payloadMs", millis(payloadNanos));
            values.put("templateMs", millis(templateNanos));
            values.put("convertMs", millis(convertNanos));
            values.put("propertiesMs", millis(propertiesNanos));
            values.put("rabbitAfterConvertMs", millis(Math.max(0, templateNanos - convertNanos - propertiesNanos)));
            values.put("convertSamples", convertSamples);
            values.put("confirmedBeforeSendReturn", confirmedBeforeSendReturn);
            values.put("confirmAfterSendReturnPerEvent", stats(confirmAfterSendReturn));
            values.put("confirmWaitMs", millis(confirmWaitNanos));
            values.put("confirmWaitPerEvent", stats(confirmWaits));
            values.put("confirmLatencyPerEvent", stats(confirmLatencies));
            values.put("markMs", millis(markNanos));
            values.put("markStartedAtEpochMs", markStartedAtEpochMs);
            values.put("markEndedAtEpochMs", markEndedAtEpochMs);
            values.put("markAcquireMs", millis(markAcquireNanos));
            values.put("markJdbc", markJdbc.summary());
            values.put("markMode", "batch");
            values.put("markRequested", markRequested);
            values.put("markCalls", markBatchDurations.size());
            values.put("markBatch", stats(markBatchDurations));
            values.put("deferMs", millis(deferNanos));
            values.put("otherMs", millis(Math.max(0, elapsed - claimNanos - sendNanos
                    - confirmWaitNanos - markNanos - deferNanos)));
            return values;
        }
    }

    /** Actual JDBC boundaries, all mark batches when perf JDBC instrumentation is enabled. */
    static final class MarkJdbc {
        int backendPid;
        int serverPrepareThreshold = -1;
        int borrowed, closed, prepareCalls, executeCalls, updatedRows, commitCalls, rollbackCalls;
        int prepareFailures, executeFailures, commitFailures, rollbackFailures, closeFailures;
        long hold, prepare, execute, commit, rollback, close;
        long executeStartedAtEpochMs, executeEndedAtEpochMs, commitStartedAtEpochMs, commitEndedAtEpochMs;
        Map<String, Object> summary() {
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("instrumented", borrowed > 0);
            values.put("backendPid", backendPid);
            values.put("serverPrepareThreshold", serverPrepareThreshold);
            values.put("borrowed", borrowed); values.put("closed", closed);
            values.put("prepareCalls", prepareCalls); values.put("executeCalls", executeCalls);
            values.put("updatedRows", updatedRows); values.put("commitCalls", commitCalls);
            values.put("rollbackCalls", rollbackCalls); values.put("prepareFailures", prepareFailures);
            values.put("executeFailures", executeFailures); values.put("commitFailures", commitFailures);
            values.put("rollbackFailures", rollbackFailures); values.put("closeFailures", closeFailures);
            values.put("holdMs", millis(hold)); values.put("prepareMs", millis(prepare));
            values.put("executeMs", millis(execute)); values.put("commitMs", millis(commit));
            values.put("rollbackMs", millis(rollback)); values.put("closeMs", millis(close));
            values.put("otherHoldMs", millis(Math.max(0, hold - prepare - execute - commit - rollback - close)));
            values.put("executeStartedAtEpochMs", executeStartedAtEpochMs); values.put("executeEndedAtEpochMs", executeEndedAtEpochMs);
            values.put("commitStartedAtEpochMs", commitStartedAtEpochMs); values.put("commitEndedAtEpochMs", commitEndedAtEpochMs);
            return values;
        }
    }

    private static Map<String, Object> stats(List<Long> values) {
        if (values.isEmpty()) return Map.of("samples", 0);
        List<Long> sorted = values.stream().sorted().toList();
        return Map.of("samples", values.size(),
                "avgMs", millis((long) values.stream().mapToLong(Long::longValue).average().orElse(0)),
                "p50Ms", millis(sorted.get((int) Math.ceil(sorted.size() * .5) - 1)),
                "p95Ms", millis(sorted.get((int) Math.ceil(sorted.size() * .95) - 1)),
                "maxMs", millis(sorted.getLast()));
    }

    private static double millis(long nanos) { return Math.round(nanos / 1_000.0) / 1_000.0; }
}
