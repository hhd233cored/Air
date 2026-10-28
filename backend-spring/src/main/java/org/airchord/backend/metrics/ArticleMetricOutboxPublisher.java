package org.airchord.backend.metrics;

import org.airchord.backend.metrics.ArticleMetricRepository.Event;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/** 批量发送，逐一核对 Confirm 和 Return，再用短事务批量标记；失败仍保留 outbox。 */
@Component
public class ArticleMetricOutboxPublisher {
    private static final Logger LOG = LoggerFactory.getLogger(ArticleMetricOutboxPublisher.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final ArticleMetricRepository repository;
    private final RabbitTemplate rabbit;
    private final boolean perfTimingEnabled;
    private final int maxBatchesPerRun;
    private final long runBudgetNanos;
    private final AtomicLong turnSequence = new AtomicLong();

    @Autowired
    public ArticleMetricOutboxPublisher(ArticleMetricRepository repository, RabbitTemplate rabbit,
            @Value("${airchord.perf-timing-enabled:false}") boolean perfTimingEnabled,
            @Value("${airchord.article-metric.publisher-max-batches:1}") int maxBatchesPerRun,
            @Value("${airchord.article-metric.publisher-run-budget-ms:250}") long runBudgetMs) {
        if (maxBatchesPerRun < 1 || maxBatchesPerRun > 10 || runBudgetMs < 1 || runBudgetMs > 1000)
            throw new IllegalArgumentException("Publisher max batches must be 1..10; run budget must be 1..1000 ms");
        this.repository = repository;
        this.rabbit = rabbit;
        this.perfTimingEnabled = perfTimingEnabled;
        this.maxBatchesPerRun = maxBatchesPerRun;
        this.runBudgetNanos = TimeUnit.MILLISECONDS.toNanos(runBudgetMs);
    }

    public ArticleMetricOutboxPublisher(ArticleMetricRepository repository, RabbitTemplate rabbit,
                                       boolean perfTimingEnabled) {
        this(repository, rabbit, perfTimingEnabled, 1, 250);
    }

    @Scheduled(fixedDelay = 100, initialDelay = 1_000)
    public void publishPending() {
        try (var scope = ArticleMetricBackgroundScope.enter()) { publishPendingInScope(); }
    }

    private void publishPendingInScope() {
        long started = System.nanoTime();
        long turnId = perfTimingEnabled ? turnSequence.incrementAndGet() : 0;
        for (int index = 0; index < maxBatchesPerRun; index++) {
            var result = publishBatch(turnId, index);
            // 满批且全部成功才继续；时间预算只用于下一批准入，不中断已领取事件的可靠处理。
            if (result.claimed() < 200 || !result.healthy() || System.nanoTime() - started >= runBudgetNanos) break;
        }
    }

    private BatchResult publishBatch(long turnId, int index) {
        var timing = ArticleMetricPublisherTiming.begin(perfTimingEnabled);
        if (timing != null) {
            timing.turnId = turnId;
            timing.batchIndex = index;
            timing.maxBatchesPerRun = maxBatchesPerRun;
        }
        boolean healthy = true;
        try {
            var pending = new ArrayList<Pending>();
            long claimStarted = timing == null ? 0 : System.nanoTime();
            List<Event> events;
            try {
                events = repository.claimOutbox(200);
            } finally {
                if (timing != null) timing.claimNanos = System.nanoTime() - claimStarted;
            }
            if (timing != null) timing.claimed = events.size();
            for (Event event : events) {
                if (timing != null) timing.phase = ArticleMetricPublisherTiming.Phase.SEND;
                long sendStarted = timing == null ? 0 : System.nanoTime();
                try {
                    try {
                        var confirmation = new CorrelationData(event.id().toString());
                        // 回调在发送前注册：记录异步确认完成时间，避免把等待 get() 的时间当成确认延迟。
                        var observed = timing == null ? null
                                : confirmation.getFuture().thenApply(ignored -> System.nanoTime());
                        long payloadStarted = timing == null ? 0 : System.nanoTime();
                        String payload = "{\"version\":1,\"eventId\":\"" + event.id() + "\"}";
                        long templateStarted = timing == null ? 0 : System.nanoTime();
                        if (timing != null) {
                            timing.payloadNanos += templateStarted - payloadStarted;
                            timing.prepareNanos += templateStarted - sendStarted;
                        }
                        try {
                            rabbit.convertAndSend(ArticleMetricMessagingConfiguration.EXCHANGE,
                                ArticleMetricMessagingConfiguration.ROUTING_KEY, payload, message -> {
                                    long propertiesStarted = timing == null ? 0 : System.nanoTime();
                                    if (timing != null) {
                                        timing.convertNanos += propertiesStarted - templateStarted;
                                        timing.convertSamples++;
                                    }
                                    try {
                                        message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
                                        message.getMessageProperties().setMessageId(event.id().toString());
                                        return message;
                                    } finally {
                                        if (timing != null) timing.propertiesNanos += System.nanoTime() - propertiesStarted;
                                    }
                                }, confirmation);
                        } finally {
                            if (timing != null) timing.templateNanos += System.nanoTime() - templateStarted;
                        }
                        long returnedAt = timing == null ? 0 : System.nanoTime();
                        pending.add(new Pending(event, confirmation, sendStarted, returnedAt, observed));
                        if (timing != null) timing.sent++;
                    } finally {
                        if (timing != null) timing.sendNanos += System.nanoTime() - sendStarted;
                    }
                } catch (Exception ex) {
                    healthy = false;
                    if (timing != null) timing.failures++;
                    LOG.warn("文章指标事件发布失败，稍后重试: {}", event.id(), ex);
                    defer(event, timing);
                }
            }
            var confirmedIds = new ArrayList<UUID>();
            // 一批共用 5 秒确认等待窗口，避免 200 个未完成 future 各等待 5 秒拖过 outbox 租约。
            long confirmDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            for (Pending item : pending) {
                try {
                    if (timing != null) timing.phase = ArticleMetricPublisherTiming.Phase.CONFIRM;
                    var confirm = awaitConfirmation(item, timing, confirmDeadline);
                    if (!confirm.ack() || item.confirmation().getReturned() != null)
                        throw new IllegalStateException("RabbitMQ 未确认文章指标消息已路由并持久化");
                    confirmedIds.add(item.event().id());
                    if (timing != null) timing.confirmed++;
                } catch (Exception ex) {
                    healthy = false;
                    if (timing != null) timing.failures++;
                    LOG.warn("文章指标事件没有发布确认，稍后重发: {}", item.event().id(), ex);
                    defer(item.event(), timing);
                }
            }
            healthy &= markConfirmed(confirmedIds, timing);
            return new BatchResult(events.size(), healthy);
        } catch (RuntimeException ex) {
            if (timing != null) timing.failures++;
            throw ex;
        } finally {
            ArticleMetricPublisherTiming.clear();
            if (timing != null && (timing.claimed > 0 || timing.failures > 0)) {
                try {
                    LOG.info("PERF_ARTICLE_PUBLISHER {}", JSON.writeValueAsString(timing.summary()));
                } catch (Exception ex) {
                    LOG.warn("无法输出发布器压测计时", ex);
                }
            }
        }
    }

    private boolean markConfirmed(List<UUID> ids, ArticleMetricPublisherTiming.Batch timing) {
        if (ids.isEmpty()) return true;
        if (timing != null) {
            timing.phase = ArticleMetricPublisherTiming.Phase.MARK;
            timing.markRequested = ids.size();
            timing.markStartedAtEpochMs = System.currentTimeMillis();
        }
        long started = timing == null ? 0 : System.nanoTime();
        try {
            int updated = repository.markPublishedBatch(ids);
            if (timing != null) timing.marked = updated;
            return updated == ids.size();
        } catch (RuntimeException ex) {
            if (timing != null) timing.failures += ids.size();
            // 无法确认数据库提交结果时保留租约；过期后重新领取，消费者幂等消除重复计数。
            LOG.warn("文章指标批量发布标记失败，等待租约到期后重发，事件数: {}", ids.size(), ex);
            return false;
        } finally {
            if (timing != null) {
                long elapsed = System.nanoTime() - started;
                timing.markNanos += elapsed;
                timing.markEndedAtEpochMs = System.currentTimeMillis();
                timing.markBatchDurations.add(elapsed);
            }
        }
    }

    private CorrelationData.Confirm awaitConfirmation(Pending item, ArticleMetricPublisherTiming.Batch timing,
                                                     long deadline)
            throws Exception {
        long started = timing == null ? 0 : System.nanoTime();
        try {
            long remaining = Math.max(0, deadline - System.nanoTime());
            if (timing == null) return item.confirmation().getFuture().get(remaining, TimeUnit.NANOSECONDS);
            long confirmedAt = item.observedConfirmationNanos().get(remaining, TimeUnit.NANOSECONDS);
            timing.confirmLatencies.add(confirmedAt - item.sendStartedNanos());
            if (confirmedAt < item.sendReturnedNanos()) timing.confirmedBeforeSendReturn++;
            timing.confirmAfterSendReturn.add(Math.max(0, confirmedAt - item.sendReturnedNanos()));
            return item.confirmation().getFuture().getNow(null);
        } finally {
            if (timing != null) {
                long elapsed = System.nanoTime() - started;
                timing.confirmWaitNanos += elapsed;
                timing.confirmWaits.add(elapsed);
            }
        }
    }

    private void defer(Event event, ArticleMetricPublisherTiming.Batch timing) {
        if (timing != null) timing.phase = ArticleMetricPublisherTiming.Phase.DEFER;
        long started = timing == null ? 0 : System.nanoTime();
        try {
            repository.defer(event.id());
        } catch (RuntimeException ex) {
            // 延期失败也不阻断其他事件的确认与标记；该事件仍可在原租约到期后重试。
            LOG.warn("文章指标事件延期失败，等待租约到期后重发: {}", event.id(), ex);
        } finally {
            if (timing != null) timing.deferNanos += System.nanoTime() - started;
        }
    }

    private record Pending(Event event, CorrelationData confirmation, long sendStartedNanos, long sendReturnedNanos,
                           CompletableFuture<Long> observedConfirmationNanos) { }
    private record BatchResult(int claimed, boolean healthy) { }
}
