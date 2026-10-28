package org.airchord.backend.music;

import org.airchord.backend.music.MusicImportRepository.OutboxEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

/** 每秒从 PostgreSQL outbox 发送小消息，确认成功后才把事件标记为已发布。 */
@Component
public class MusicImportOutboxPublisher {
    private static final Logger LOGGER = LoggerFactory.getLogger(MusicImportOutboxPublisher.class);
    private final MusicImportRepository jobs;
    private final RabbitTemplate rabbit;

    public MusicImportOutboxPublisher(MusicImportRepository jobs, RabbitTemplate rabbit) {
        this.jobs = jobs;
        this.rabbit = rabbit;
    }

    @Scheduled(fixedDelay = 1_000, initialDelay = 1_000)
    public void publishPending() {
        for (OutboxEvent event : jobs.claimOutbox()) {
            try {
                CorrelationData confirmation = new CorrelationData(event.id().toString());
                String json = "{\"version\":1,\"jobId\":\"" + event.jobId() + "\"}";
                rabbit.convertAndSend(MusicImportMessagingConfiguration.EXCHANGE,
                        MusicImportMessagingConfiguration.ROUTING_KEY, json, message -> {
                            message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
                            message.getMessageProperties().setMessageId(event.id().toString());
                            return message;
                        }, confirmation);
                CorrelationData.Confirm result = confirmation.getFuture().get(5, TimeUnit.SECONDS);
                if (!result.ack() || confirmation.getReturned() != null)
                    throw new IllegalStateException("RabbitMQ 未确认路由和持久化");
                jobs.markPublished(event.id());
            } catch (Exception ex) {
                LOGGER.warn("音频任务消息稍后重发: eventId={} jobId={}", event.id(), event.jobId(), ex);
                try { jobs.deferOutbox(event.id()); }
                catch (Exception dbEx) { LOGGER.error("无法更新 outbox 重试时间: {}", event.id(), dbEx); }
            }
        }
    }
}
