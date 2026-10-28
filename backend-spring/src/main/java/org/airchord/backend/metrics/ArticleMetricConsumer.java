package org.airchord.backend.metrics;

import com.rabbitmq.client.Channel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;

/** 一批一次事务；提交和缓存失效完成后才 ACK，重投由事件唯一键防重。 */
@Component
public class ArticleMetricConsumer {
    private static final Logger LOG = LoggerFactory.getLogger(ArticleMetricConsumer.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final ArticleMetricRepository repository;
    private final ArticleStatsCache cache;
    private final boolean perfTimingEnabled;

    public ArticleMetricConsumer(ArticleMetricRepository repository, ArticleStatsCache cache,
                                 @Value("${airchord.perf-timing-enabled:false}") boolean perfTimingEnabled) {
        this.repository = repository;
        this.cache = cache;
        this.perfTimingEnabled = perfTimingEnabled;
    }

    @RabbitListener(queues = ArticleMetricMessagingConfiguration.QUEUE,
            containerFactory = "articleMetricListenerFactory")
    public void consume(List<Message> messages, Channel channel) throws IOException {
        var timing = ArticleMetricConsumerTiming.begin(perfTimingEnabled);
        if (timing != null) {
            timing.sampleKind = "batch";
            timing.received = messages.size();
            timing.metricType = "BATCH";
        }
        try (var scope = ArticleMetricBackgroundScope.enter()) { consumeCurrent(messages, channel, timing); }
        finally { ArticleMetricConsumerTiming.finish(timing); }
    }

    private void consumeCurrent(List<Message> messages, Channel channel, ArticleMetricConsumerTiming.Sample timing)
            throws IOException {
        // 本协议逐条发布。框架拆开的生产者批消息共享 tag，必须整条拒绝，不能覆盖片段后 ACK。
        var seenTags = new HashSet<Long>();
        var sharedTags = new LinkedHashSet<Long>();
        for (var message : messages) {
            long tag = message.getMessageProperties().getDeliveryTag();
            if (!seenTags.add(tag)) sharedTags.add(tag);
        }
        for (long tag : sharedTags) {
            LOG.warn("文章指标不支持生产者批消息，整条送入死信队列: deliveryTag={}", tag);
            acknowledge(channel, tag, Disposition.REJECT, timing);
        }
        // 逐条确认，避免跨过已经拒绝的 deliveryTag。
        var pending = new LinkedHashMap<Long, UUID>();
        for (var message : messages) {
            long tag = message.getMessageProperties().getDeliveryTag();
            if (sharedTags.contains(tag)) {
                if (timing != null) timing.rejected++;
                continue;
            }
            long started = timing == null ? 0 : System.nanoTime();
            UUID id = null;
            Exception decodeFailure = null;
            try {
                var payload = JSON.readTree(new String(message.getBody(), StandardCharsets.UTF_8));
                if (payload.path("version").asInt() != 1) throw new IllegalArgumentException("未知事件版本");
                id = UUID.fromString(payload.path("eventId").asText());
            } catch (Exception ex) {
                decodeFailure = ex;
            } finally {
                if (timing != null) timing.decodeNanos += System.nanoTime() - started;
            }
            if (decodeFailure != null) {
                LOG.warn("文章指标消息格式错误，送入死信队列", decodeFailure);
                acknowledge(channel, tag, Disposition.REJECT, timing);
                if (timing != null) timing.rejected++;
                continue;
            }
            pending.put(tag, id);
        }
        if (pending.isEmpty()) {
            if (timing != null) timing.outcome = "REJECTED";
            return;
        }
        List<ArticleMetricRepository.Event> found;
        try {
            if (timing != null) timing.phase = ArticleMetricConsumerTiming.Phase.EVENT;
            long started = timing == null ? 0 : System.nanoTime();
            try { found = repository.events(pending.values().stream().distinct().toList()); }
            finally { if (timing != null) timing.eventNanos += System.nanoTime() - started; }
        } catch (RuntimeException ex) {
            requeue(pending, channel, timing, ex);
            return;
        }
        var byId = new LinkedHashMap<UUID, ArticleMetricRepository.Event>();
        for (var event : found) byId.put(event.id(), event);
        for (var iterator = pending.entrySet().iterator(); iterator.hasNext();) {
            var entry = iterator.next();
            if (!byId.containsKey(entry.getValue())) {
                LOG.warn("文章指标消息没有对应的 outbox，送入死信队列: {}", entry.getValue());
                acknowledge(channel, entry.getKey(), Disposition.REJECT, timing);
                iterator.remove();
                if (timing != null) timing.rejected++;
            }
        }
        if (pending.isEmpty()) {
            if (timing != null) timing.outcome = "REJECTED";
            return;
        }
        ArticleMetricRepository.BatchApplied result;
        try {
            if (timing != null) timing.phase = ArticleMetricConsumerTiming.Phase.APPLY;
            long started = timing == null ? 0 : System.nanoTime();
            // 调用 Spring 事务代理：方法返回时提交已经成功。
            try { result = repository.applyBatch(new ArrayList<>(byId.values())); }
            finally { if (timing != null) timing.applyCallNanos += System.nanoTime() - started; }
            if (timing != null) {
                timing.applied = result.eventIds().size();
                timing.duplicate = pending.size() - timing.applied;
                timing.viewEvents = result.viewEvents();
                timing.likeEvents = result.likeEvents();
                timing.cacheArticles = result.articleIds().size();
                timing.cacheAttempted = !result.articleIds().isEmpty();
                timing.phase = ArticleMetricConsumerTiming.Phase.CACHE;
            }
            started = timing == null ? 0 : System.nanoTime();
            try { if (!result.articleIds().isEmpty()) cache.evictBatch(result.articleIds()); }
            finally { if (timing != null) timing.cacheNanos += System.nanoTime() - started; }
        } catch (RuntimeException ex) {
            requeue(pending, channel, timing, ex);
            return;
        }
        // ACK IOException 交给容器恢复连接，不再 NACK 已经 ACK 的 deliveryTag。
        for (long tag : pending.keySet()) acknowledge(channel, tag, Disposition.ACK, timing);
        if (timing != null) timing.outcome = result.eventIds().isEmpty() ? "DUPLICATE" : "APPLIED";
    }

    private void requeue(LinkedHashMap<Long, UUID> pending, Channel channel,
                         ArticleMetricConsumerTiming.Sample timing, RuntimeException failure) throws IOException {
        LOG.warn("文章指标批次处理失败，等待重投，消息数: {}", pending.size(), failure);
        for (long tag : pending.keySet()) acknowledge(channel, tag, Disposition.NACK, timing);
        if (timing != null) {
            timing.requeued = pending.size();
            timing.outcome = "REQUEUED";
        }
    }

    private void acknowledge(Channel channel, long tag, Disposition disposition,
                              ArticleMetricConsumerTiming.Sample timing) throws IOException {
        var previous = timing == null ? null : timing.phase;
        if (timing != null) timing.phase = ArticleMetricConsumerTiming.Phase.ACK;
        long started = timing == null ? 0 : System.nanoTime();
        try {
            switch (disposition) {
                case ACK -> channel.basicAck(tag, false);
                case REJECT -> channel.basicReject(tag, false);
                case NACK -> channel.basicNack(tag, false, true);
            }
        } finally {
            if (timing != null) {
                timing.ackNanos += System.nanoTime() - started;
                timing.phase = previous;
            }
        }
    }

    private enum Disposition { ACK, REJECT, NACK }
}
