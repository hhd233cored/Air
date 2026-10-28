package org.airchord.backend.metrics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;

/** 压测专用：保留消费调用的原始样本；批次耗时不能当作单条消息延迟。 */
@Component
@ConditionalOnProperty(name = "airchord.perf-timing-enabled", havingValue = "true")
public class ArticleMetricConsumerTiming {
    private static final Logger LOG = LoggerFactory.getLogger(ArticleMetricConsumerTiming.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final ThreadLocal<Sample> CURRENT = new ThreadLocal<>();
    private static final ConcurrentLinkedQueue<Map<String, Object>> COMPLETED = new ConcurrentLinkedQueue<>();

    static Sample begin(boolean enabled) {
        if (!enabled) return null;
        Sample sample = new Sample();
        CURRENT.set(sample);
        return sample;
    }

    static void finish(Sample sample) {
        CURRENT.remove();
        if (sample != null) COMPLETED.add(sample.summary());
    }

    static void connectionAcquire(long nanos) {
        Sample sample = CURRENT.get();
        if (sample == null) return;
        if (sample.phase == Phase.EVENT) sample.eventAcquireNanos += nanos;
        else if (sample.phase == Phase.APPLY) sample.applyAcquireNanos += nanos;
    }

    static boolean active() { return CURRENT.get() != null; }
    static void applyBody(long nanos) { if (active()) CURRENT.get().applyBodyNanos += nanos; }
    static void processedSql(long nanos) { if (active()) CURRENT.get().processedSqlNanos += nanos; }
    static void statsSql(long nanos) {
        if (active()) { CURRENT.get().statsSqlNanos += nanos; CURRENT.get().statsSqlCalls++; }
    }
    static void cacheDeleteCall() { if (active()) CURRENT.get().cacheDeleteCalls++; }
    static void cacheEvictionFailed(int articles) {
        if (active()) {
            CURRENT.get().cacheEvictionFailures++;
            CURRENT.get().cacheEvictionFailedArticles += articles;
        }
    }

    static void observeCommit() {
        Sample sample = CURRENT.get();
        if (sample == null || !TransactionSynchronizationManager.isSynchronizationActive()) return;
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            private long before;
            @Override public void beforeCommit(boolean readOnly) { before = System.nanoTime(); }
            @Override public void afterCommit() {
                sample.commitApproxNanos += System.nanoTime() - before;
                sample.commitSamples++;
            }
            @Override public void afterCompletion(int status) {
                sample.transactionCompletion = status == STATUS_COMMITTED ? "COMMITTED"
                        : status == STATUS_ROLLED_BACK ? "ROLLED_BACK" : "UNKNOWN";
            }
        });
    }

    static List<Map<String, Object>> drain(int limit) {
        var samples = new ArrayList<Map<String, Object>>();
        for (int i = 0; i < limit; i++) {
            var sample = COMPLETED.poll();
            if (sample == null) break;
            samples.add(sample);
        }
        return samples;
    }

    @Scheduled(fixedDelay = 1_000)
    public void flush() {
        // 单消费者下通常每秒数百条；每行最多 100 个原始样本，分位数仍可精确重算。
        for (int chunk = 0; chunk < 10; chunk++) {
            var samples = drain(100);
            if (samples.isEmpty()) return;
            try {
                LOG.info("PERF_ARTICLE_CONSUMER {}", JSON.writeValueAsString(
                        Map.of("event", "consumer-samples", "samples", samples)));
            } catch (Exception ex) {
                LOG.warn("无法输出消费者压测计时", ex);
            }
        }
    }

    enum Phase { OTHER, EVENT, APPLY, CACHE, ACK }

    static final class Sample {
        final long startedAtEpochMs = System.currentTimeMillis();
        final long startedNanos = System.nanoTime();
        Phase phase = Phase.OTHER;
        String metricType = "UNKNOWN";
        String outcome = "REQUEUED";
        String transactionCompletion = "NOT_OBSERVED";
        int commitSamples;
        int cacheEvictionFailures;
        int cacheEvictionFailedArticles;
        int cacheDeleteCalls;
        int statsSqlCalls;
        boolean cacheAttempted;
        String sampleKind = "single";
        int received = 1, applied, duplicate, rejected, requeued, viewEvents, likeEvents, cacheArticles;
        long decodeNanos;
        long eventNanos;
        long eventAcquireNanos;
        long applyCallNanos;
        long applyAcquireNanos;
        long applyBodyNanos;
        long processedSqlNanos;
        long statsSqlNanos;
        long commitApproxNanos;
        long cacheNanos;
        long ackNanos;

        Map<String, Object> summary() {
            long elapsed = System.nanoTime() - startedNanos;
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("startedAtEpochMs", startedAtEpochMs);
            values.put("sampleKind", sampleKind);
            values.put("received", received);
            values.put("applied", applied);
            values.put("duplicate", duplicate);
            values.put("rejected", rejected);
            values.put("requeued", requeued);
            values.put("viewEvents", viewEvents);
            values.put("likeEvents", likeEvents);
            values.put("cacheArticles", cacheArticles);
            values.put("endedAtEpochMs", System.currentTimeMillis());
            values.put("metricType", metricType);
            values.put("outcome", outcome);
            values.put("transactionCompletion", transactionCompletion);
            values.put("commitSamples", commitSamples);
            values.put("cacheAttempted", cacheAttempted);
            values.put("cacheEvictionFailures", cacheEvictionFailures);
            values.put("cacheEvictionFailedArticles", cacheEvictionFailedArticles);
            values.put("cacheDeleteCalls", cacheDeleteCalls);
            values.put("statsSqlCalls", statsSqlCalls);
            values.put("cycleMs", ms(elapsed));
            values.put("decodeMs", ms(decodeNanos));
            values.put("eventMs", ms(eventNanos));
            values.put("eventAcquireMs", ms(eventAcquireNanos));
            values.put("applyCallMs", ms(applyCallNanos));
            values.put("applyAcquireMs", ms(applyAcquireNanos));
            values.put("applyBodyMs", ms(applyBodyNanos));
            values.put("processedSqlMs", ms(processedSqlNanos));
            values.put("statsSqlMs", ms(statsSqlNanos));
            values.put("commitApproxMs", ms(commitApproxNanos));
            values.put("applyOtherMs", ms(Math.max(0, applyCallNanos - applyBodyNanos
                    - applyAcquireNanos - commitApproxNanos)));
            values.put("cacheMs", ms(cacheNanos));
            values.put("ackMs", ms(ackNanos));
            values.put("otherMs", ms(Math.max(0, elapsed - decodeNanos - eventNanos
                    - applyCallNanos - cacheNanos - ackNanos)));
            return values;
        }
    }

    private static double ms(long nanos) { return Math.round(nanos / 1_000.0) / 1_000.0; }
}
