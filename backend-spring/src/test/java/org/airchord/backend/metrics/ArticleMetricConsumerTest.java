package org.airchord.backend.metrics;

import com.rabbitmq.client.Channel;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.amqp.core.Message;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class ArticleMetricConsumerTest {
    @AfterEach
    void clearsThreadTiming() {
        assertThat(ArticleMetricConsumerTiming.active()).isFalse();
        ArticleMetricConsumerTiming.drain(Integer.MAX_VALUE);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void appliedEventEvictsCacheBeforeAck(boolean timing) throws Exception {
        var repository = mock(ArticleMetricRepository.class);
        var cache = mock(ArticleStatsCache.class);
        var channel = mock(Channel.class);
        var event = event();
        when(repository.events(List.of(event.id()))).thenReturn(List.of(event));
        when(repository.applyBatch(List.of(event))).thenReturn(new ArticleMetricRepository.BatchApplied(List.of(event.id()), List.of(event.articleId()), 1, 0));

        new ArticleMetricConsumer(repository, cache, timing).consume(List.of(message(event.id())), channel);

        var order = inOrder(repository, cache, channel);
        order.verify(repository).events(List.of(event.id()));
        order.verify(repository).applyBatch(List.of(event));
        order.verify(cache).evictBatch(List.of(event.articleId()));
        order.verify(channel).basicAck(7, false);
        verify(channel, never()).basicNack(anyLong(), anyBoolean(), anyBoolean());
        var samples = ArticleMetricConsumerTiming.drain(100);
        assertThat(samples).hasSize(timing ? 1 : 0);
        if (timing) {
            assertThat(samples.getFirst()).containsEntry("outcome", "APPLIED")
                    .containsEntry("metricType", "BATCH").containsEntry("cacheAttempted", true);
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void redeliveryDoesNotEvictAgain(boolean timing) throws Exception {
        var repository = mock(ArticleMetricRepository.class);
        var cache = mock(ArticleStatsCache.class);
        var channel = mock(Channel.class);
        var event = event();
        when(repository.events(List.of(event.id()))).thenReturn(List.of(event));
        when(repository.applyBatch(List.of(event))).thenReturn(new ArticleMetricRepository.BatchApplied(List.of(), List.of(), 0, 0));

        new ArticleMetricConsumer(repository, cache, timing).consume(List.of(message(event.id())), channel);

        verifyNoInteractions(cache);
        verify(channel).basicAck(7, false);
        if (timing) assertThat(ArticleMetricConsumerTiming.drain(100).getFirst())
                .containsEntry("outcome", "DUPLICATE").containsEntry("cacheAttempted", false);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void applyFailureRequeuesWithoutCacheOrAck(boolean timing) throws Exception {
        var repository = mock(ArticleMetricRepository.class);
        var cache = mock(ArticleStatsCache.class);
        var channel = mock(Channel.class);
        var event = event();
        when(repository.events(List.of(event.id()))).thenReturn(List.of(event));
        when(repository.applyBatch(List.of(event))).thenThrow(new IllegalStateException("db failure"));

        new ArticleMetricConsumer(repository, cache, timing).consume(List.of(message(event.id())), channel);

        verifyNoInteractions(cache);
        verify(channel).basicNack(7, false, true);
        verify(channel, never()).basicAck(anyLong(), anyBoolean());
        if (timing) assertThat(ArticleMetricConsumerTiming.drain(100).getFirst())
                .containsEntry("outcome", "REQUEUED");
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void invalidOrMissingEventIsRejected(boolean timing) throws Exception {
        var repository = mock(ArticleMetricRepository.class);
        var cache = mock(ArticleStatsCache.class);
        var channel = mock(Channel.class);
        var consumer = new ArticleMetricConsumer(repository, cache, timing);
        var invalid = new Message("invalid JSON".getBytes(StandardCharsets.UTF_8));
        invalid.getMessageProperties().setDeliveryTag(8);

        consumer.consume(List.of(invalid), channel);
        consumer.consume(List.of(message(UUID.randomUUID())), channel);

        verify(channel).basicReject(8, false);
        verify(channel).basicReject(7, false);
        verify(repository, never()).applyBatch(any());
        verifyNoInteractions(cache);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void redisDeleteFailureStillAcksCommittedEventAndIsRecorded(boolean timing) throws Exception {
        var repository = mock(ArticleMetricRepository.class);
        var redis = mock(StringRedisTemplate.class);
        var channel = mock(Channel.class);
        var event = event();
        when(repository.events(List.of(event.id()))).thenReturn(List.of(event));
        when(repository.applyBatch(List.of(event))).thenReturn(new ArticleMetricRepository.BatchApplied(List.of(event.id()), List.of(event.articleId()), 1, 0));
        when(redis.delete(anyCollection())).thenThrow(new RedisConnectionFailureException("redis unavailable"));

        new ArticleMetricConsumer(repository, new ArticleStatsCache(redis), timing)
                .consume(List.of(message(event.id())), channel);

        verify(channel).basicAck(7, false);
        verify(channel, never()).basicNack(anyLong(), anyBoolean(), anyBoolean());
        if (timing) assertThat(ArticleMetricConsumerTiming.drain(100).getFirst())
                .containsEntry("outcome", "APPLIED").containsEntry("cacheEvictionFailures", 1);
    }

    private static ArticleMetricRepository.Event event() {
        return new ArticleMetricRepository.Event(UUID.randomUUID(), "article", "VIEW", 1);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void multiArticleBatchEvictsTogetherAfterApplyAndBeforeAnyAck(boolean timing) throws Exception {
        var repository = mock(ArticleMetricRepository.class);
        var cache = mock(ArticleStatsCache.class);
        var channel = mock(Channel.class);
        var first = event();
        var second = new ArticleMetricRepository.Event(UUID.randomUUID(), "other", "LIKE", -1);
        var other = message(second.id());
        other.getMessageProperties().setDeliveryTag(8);
        when(repository.events(List.of(first.id(), second.id()))).thenReturn(List.of(first, second));
        when(repository.applyBatch(List.of(first, second))).thenReturn(new ArticleMetricRepository.BatchApplied(
                List.of(first.id(), second.id()), List.of("article", "other"), 1, 1));
        new ArticleMetricConsumer(repository, cache, timing).consume(List.of(message(first.id()), other), channel);
        var order = inOrder(repository, cache, channel);
        order.verify(repository).applyBatch(List.of(first, second));
        order.verify(cache).evictBatch(List.of("article", "other"));
        order.verify(channel).basicAck(7, false);
        order.verify(channel).basicAck(8, false);
        verifyNoMoreInteractions(cache);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void producerBatchFragmentsWithSharedTagAreRejectedOnceWithoutApplyingAnyFragment(boolean timing) throws Exception {
        var repository = mock(ArticleMetricRepository.class);
        var cache = mock(ArticleStatsCache.class);
        var channel = mock(Channel.class);
        var fragment1 = message(UUID.randomUUID());
        var fragment2 = message(UUID.randomUUID()); // 两个有效 JSON，但同一个 broker deliveryTag。
        var valid = event();
        var normal = message(valid.id());
        normal.getMessageProperties().setDeliveryTag(8);
        when(repository.events(List.of(valid.id()))).thenReturn(List.of(valid));
        when(repository.applyBatch(List.of(valid))).thenReturn(new ArticleMetricRepository.BatchApplied(
                List.of(valid.id()), List.of("article"), 1, 0));
        new ArticleMetricConsumer(repository, cache, timing).consume(List.of(fragment1, normal, fragment2), channel);
        verify(channel, times(1)).basicReject(7, false);
        verify(channel, never()).basicAck(7, false);
        verify(channel).basicAck(8, false);
        verify(repository).applyBatch(List.of(valid));
        verify(cache).evictBatch(List.of("article"));
        if (timing) assertThat(ArticleMetricConsumerTiming.drain(100).getFirst())
                .containsEntry("received", 3).containsEntry("rejected", 2).containsEntry("applied", 1);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void mixedBatchRejectsPoisonAndAcksDuplicateDeliveryAfterOneApply(boolean timing) throws Exception {
        var repository = mock(ArticleMetricRepository.class);
        var cache = mock(ArticleStatsCache.class);
        var channel = mock(Channel.class);
        var first = event();
        var second = event();
        var missing = UUID.randomUUID();
        var repeated = message(first.id());
        repeated.getMessageProperties().setDeliveryTag(9);
        var other = message(second.id());
        other.getMessageProperties().setDeliveryTag(10);
        var absent = message(missing);
        absent.getMessageProperties().setDeliveryTag(11);
        var poison = new Message("bad".getBytes(StandardCharsets.UTF_8));
        poison.getMessageProperties().setDeliveryTag(12);
        when(repository.events(List.of(first.id(), second.id(), missing))).thenReturn(List.of(first, second));
        when(repository.applyBatch(List.of(first, second))).thenReturn(new ArticleMetricRepository.BatchApplied(
                List.of(first.id(), second.id()), List.of("article"), 2, 0));
        new ArticleMetricConsumer(repository, cache, timing).consume(
                List.of(message(first.id()), repeated, other, absent, poison), channel);
        verify(channel).basicReject(11, false);
        verify(channel).basicReject(12, false);
        var order = inOrder(repository, cache, channel);
        order.verify(repository).applyBatch(List.of(first, second));
        order.verify(cache).evictBatch(List.of("article"));
        order.verify(channel).basicAck(7, false);
        order.verify(channel).basicAck(9, false);
        order.verify(channel).basicAck(10, false);
        verify(cache, times(1)).evictBatch(anyCollection());
        if (timing) assertThat(ArticleMetricConsumerTiming.drain(100).getFirst())
                .containsEntry("received", 5).containsEntry("applied", 2)
                .containsEntry("duplicate", 1).containsEntry("rejected", 2);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void failedBatchRequeuesAllValidMessagesAndRetryAcks(boolean timing) throws Exception {
        var repository = mock(ArticleMetricRepository.class);
        var cache = mock(ArticleStatsCache.class);
        var channel = mock(Channel.class);
        var first = event();
        var second = event();
        var other = message(second.id());
        other.getMessageProperties().setDeliveryTag(8);
        when(repository.events(List.of(first.id(), second.id()))).thenReturn(List.of(first, second));
        when(repository.applyBatch(List.of(first, second))).thenThrow(new IllegalStateException("commit failed"))
                .thenReturn(new ArticleMetricRepository.BatchApplied(List.of(first.id(), second.id()),
                        List.of("article"), 2, 0));
        var consumer = new ArticleMetricConsumer(repository, cache, timing);
        consumer.consume(List.of(message(first.id()), other), channel);
        verify(channel).basicNack(7, false, true);
        verify(channel).basicNack(8, false, true);
        verifyNoInteractions(cache);
        verify(channel, never()).basicAck(anyLong(), anyBoolean());
        consumer.consume(List.of(message(first.id()), other), channel);
        verify(channel).basicAck(7, false);
        verify(channel).basicAck(8, false);
        verify(cache, times(1)).evictBatch(List.of("article"));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void ackFailureDoesNotNackAlreadyAcknowledgedTags(boolean timing) throws Exception {
        var repository = mock(ArticleMetricRepository.class);
        var cache = mock(ArticleStatsCache.class);
        var channel = mock(Channel.class);
        var first = event();
        var repeated = message(first.id());
        repeated.getMessageProperties().setDeliveryTag(8);
        when(repository.events(List.of(first.id()))).thenReturn(List.of(first));
        when(repository.applyBatch(List.of(first))).thenReturn(new ArticleMetricRepository.BatchApplied(
                List.of(first.id()), List.of("article"), 1, 0));
        doThrow(new java.io.IOException("connection lost")).when(channel).basicAck(8, false);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> new ArticleMetricConsumer(repository, cache, timing)
                .consume(List.of(message(first.id()), repeated), channel)).isInstanceOf(java.io.IOException.class);
        verify(channel).basicAck(7, false);
        verify(channel, never()).basicNack(anyLong(), anyBoolean(), anyBoolean());
    }

    private static Message message(UUID id) {
        var message = new Message(("{\"version\":1,\"eventId\":\"" + id + "\"}")
                .getBytes(StandardCharsets.UTF_8));
        message.getMessageProperties().setDeliveryTag(7);
        return message;
    }
}


