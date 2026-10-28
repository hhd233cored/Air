package org.airchord.backend.metrics;

import org.airchord.backend.metrics.ArticleMetricRepository.Event;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessagePostProcessor;
import org.springframework.amqp.core.ReturnedMessage;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** 验证可标记的事件集合与数据库失败后的保留行为，覆盖开关两种配置。 */
class ArticleMetricOutboxPublisherTest {
    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void consecutiveFullBatchesAreBoundedAndMarkedSeparately(boolean timing) {
        var repository = mock(ArticleMetricRepository.class);
        var rabbit = mock(RabbitTemplate.class);
        when(repository.claimOutbox(200)).thenAnswer(call ->
                java.util.stream.IntStream.range(0, 200).mapToObj(i -> event()).toList());
        when(repository.markPublishedBatch(anyList())).thenAnswer(call -> ((List<?>) call.getArgument(0)).size());
        immediateAcks(rabbit);
        new ArticleMetricOutboxPublisher(repository, rabbit, timing, 3, 1000).publishPending();
        verify(repository, times(3)).claimOutbox(200);
        verify(repository, times(3)).markPublishedBatch(argThat(ids -> ids.size() == 200));
        verify(rabbit, times(600)).convertAndSend(anyString(), anyString(), any(Object.class),
                any(MessagePostProcessor.class), any(CorrelationData.class));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void partialBatchStopsWithoutImmediatelyPollingEmptyQueue(boolean timing) {
        var repository = mock(ArticleMetricRepository.class);
        var rabbit = mock(RabbitTemplate.class);
        when(repository.claimOutbox(200)).thenReturn(List.of(event()));
        when(repository.markPublishedBatch(anyList())).thenReturn(1);
        immediateAcks(rabbit);
        new ArticleMetricOutboxPublisher(repository, rabbit, timing, 4, 1000).publishPending();
        verify(repository, times(1)).claimOutbox(200);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void fullBatchMarkFailurePreventsClaimingNextBatch(boolean timing) {
        var repository = mock(ArticleMetricRepository.class);
        var rabbit = mock(RabbitTemplate.class);
        when(repository.claimOutbox(200)).thenReturn(java.util.stream.IntStream.range(0, 200).mapToObj(i -> event()).toList());
        doThrow(new IllegalStateException("commit failed")).when(repository).markPublishedBatch(anyList());
        immediateAcks(rabbit);
        new ArticleMetricOutboxPublisher(repository, rabbit, timing, 4, 1000).publishPending();
        verify(repository, times(1)).claimOutbox(200);
        verify(repository, never()).defer(any());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void runBudgetStopsFurtherClaimsAfterSlowBatch(boolean timing) {
        var repository = mock(ArticleMetricRepository.class);
        var rabbit = mock(RabbitTemplate.class);
        when(repository.claimOutbox(200)).thenReturn(java.util.stream.IntStream.range(0, 200).mapToObj(i -> event()).toList());
        when(repository.markPublishedBatch(anyList())).thenAnswer(call -> { Thread.sleep(5); return 200; });
        immediateAcks(rabbit);
        new ArticleMetricOutboxPublisher(repository, rabbit, timing, 4, 1).publishPending();
        verify(repository, times(1)).claimOutbox(200);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void wholeBatchSharesOneConfirmTimeoutWindow(boolean timing) {
        var repository = mock(ArticleMetricRepository.class);
        var rabbit = mock(RabbitTemplate.class);
        var events = List.of(event(), event(), event());
        when(repository.claimOutbox(200)).thenReturn(events);
        // 三个 future 全不完成：整个批次只等约 5 秒，不应逐个等共 15 秒。
        long started = System.nanoTime();
        new ArticleMetricOutboxPublisher(repository, rabbit, timing).publishPending();
        assertThat(java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)).isBetween(4500L, 10000L);
        verify(repository, never()).markPublishedBatch(anyList());
        for (var event : events) verify(repository).defer(event.id());
    }

    private static void immediateAcks(RabbitTemplate rabbit) {
        doAnswer(call -> {
            var message = call.<MessagePostProcessor>getArgument(3).postProcessMessage(new Message(new byte[0]));
            assertThat(message.getMessageProperties().getDeliveryMode())
                    .isEqualTo(org.springframework.amqp.core.MessageDeliveryMode.PERSISTENT);
            assertThat(message.getMessageProperties().getMessageId()).isNotBlank();
            ack(call.getArgument(4));
            return null;
        }).when(rabbit).convertAndSend(anyString(), anyString(), any(Object.class),
                any(MessagePostProcessor.class), any(CorrelationData.class));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void waitsForConfirmationBeforeStartingBatchMark(boolean timing) throws Exception {
        var repository = mock(ArticleMetricRepository.class);
        var rabbit = mock(RabbitTemplate.class);
        var first = event();
        var second = event();
        when(repository.claimOutbox(200)).thenReturn(List.of(first, second));
        when(repository.markPublishedBatch(anyList())).thenReturn(2);
        var waiting = new CompletableFuture<CorrelationData>();
        mockSends(rabbit, repository, List.of(ArticleMetricOutboxPublisherTest::ack,
                confirmation -> waiting.complete(confirmation)));
        var publisher = new ArticleMetricOutboxPublisher(repository, rabbit, timing);
        var publishing = CompletableFuture.runAsync(publisher::publishPending);
        var confirmation = waiting.get(3, TimeUnit.SECONDS);
        try {
            verify(repository, never()).markPublishedBatch(anyList());
        } finally {
            ack(confirmation);
            publishing.get(3, TimeUnit.SECONDS);
        }
        verify(repository).markPublishedBatch(List.of(first.id(), second.id()));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void marksOnlyAckedAndRoutedEventsInOneCall(boolean timing) {
        var repository = mock(ArticleMetricRepository.class);
        var rabbit = mock(RabbitTemplate.class);
        var events = java.util.stream.IntStream.range(0, 6).mapToObj(i -> event()).toList();
        when(repository.claimOutbox(200)).thenReturn(events);
        when(repository.markPublishedBatch(anyList())).thenReturn(2);
        mockSends(rabbit, repository, List.of(
                confirmation -> ack(confirmation),
                confirmation -> confirmation.getFuture().complete(new CorrelationData.Confirm(false, "nack")),
                confirmation -> {
                    confirmation.setReturned(new ReturnedMessage(new Message(new byte[0]), 312,
                            "NO_ROUTE", "exchange", "key"));
                    ack(confirmation);
                },
                confirmation -> { throw new IllegalStateException("send failed"); },
                confirmation -> confirmation.getFuture().completeExceptionally(new TimeoutException("confirm timeout")),
                confirmation -> ack(confirmation)));
        // 一个失败事件的延期调用出错，也必须继续核对并标记其他成功事件。
        doThrow(new IllegalStateException("defer unavailable")).when(repository).defer(events.get(1).id());

        new ArticleMetricOutboxPublisher(repository, rabbit, timing).publishPending();

        verify(repository).markPublishedBatch(List.of(events.get(0).id(), events.get(5).id()));
        for (int i : new int[]{1, 2, 3, 4}) verify(repository).defer(events.get(i).id());
        verify(repository, never()).defer(events.get(0).id());
        verify(repository, never()).defer(events.get(5).id());
        verify(repository, times(1)).markPublishedBatch(anyList());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void batchMarkFailureKeepsEventsForLeaseRetry(boolean timing) {
        var repository = mock(ArticleMetricRepository.class);
        var rabbit = mock(RabbitTemplate.class);
        var first = event();
        var second = event();
        when(repository.claimOutbox(200)).thenReturn(List.of(first, second));
        mockSends(rabbit, repository, List.of(ArticleMetricOutboxPublisherTest::ack,
                ArticleMetricOutboxPublisherTest::ack));
        doThrow(new IllegalStateException("commit failed")).when(repository).markPublishedBatch(anyList());

        assertThatCode(() -> new ArticleMetricOutboxPublisher(repository, rabbit, timing).publishPending())
                .doesNotThrowAnyException();

        verify(repository).markPublishedBatch(List.of(first.id(), second.id()));
        // 不尝试逐条标记或修改重试状态；保留数据库中的未发布状态与原租约。
        verify(repository, never()).defer(any());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void noSuccessfulConfirmationDoesNotCallBatchMark(boolean timing) {
        var repository = mock(ArticleMetricRepository.class);
        var rabbit = mock(RabbitTemplate.class);
        var event = event();
        when(repository.claimOutbox(200)).thenReturn(List.of(event));
        mockSends(rabbit, repository, List.of(confirmation ->
                confirmation.getFuture().complete(new CorrelationData.Confirm(false, "nack"))));

        new ArticleMetricOutboxPublisher(repository, rabbit, timing).publishPending();

        verify(repository, never()).markPublishedBatch(anyList());
        verify(repository).defer(event.id());
    }

    private static Event event() { return new Event(UUID.randomUUID(), "article", "VIEW", 1); }
    private static void ack(CorrelationData confirmation) {
        confirmation.getFuture().complete(new CorrelationData.Confirm(true, null));
    }

    private static void mockSends(RabbitTemplate rabbit, ArticleMetricRepository repository,
                                  List<Consumer<CorrelationData>> outcomes) {
        int[] index = {0};
        doAnswer(invocation -> {
            // 所有发送发生在批量标记之前。
            verify(repository, never()).markPublishedBatch(anyList());
            outcomes.get(index[0]++).accept(invocation.getArgument(4));
            return null;
        }).when(rabbit).convertAndSend(anyString(), anyString(), any(Object.class),
                any(MessagePostProcessor.class), any(CorrelationData.class));
    }
}
