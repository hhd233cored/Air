package org.airchord.backend.music;

import com.rabbitmq.client.Channel;
import org.airchord.backend.music.MusicImportRepository.Job;
import org.airchord.backend.web.BackendApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

/** 单消费者串行导入；确认发生在文件与任务状态更新后，重复消息由固定 trackId 消解。 */
@Component
public class MusicImportConsumer {
    private static final Logger LOGGER = LoggerFactory.getLogger(MusicImportConsumer.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final OffsetDateTime processStartedAt = OffsetDateTime.now(ZoneOffset.UTC);
    private final MusicImportRepository jobs;
    private final MusicImportStaging staging;
    private final LocalMusicService music;

    public MusicImportConsumer(MusicImportRepository jobs, MusicImportStaging staging, LocalMusicService music) {
        this.jobs = jobs;
        this.staging = staging;
        this.music = music;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void recoverAfterRestart() {
        jobs.resetRunningAfterRestart(processStartedAt);
    }

    @RabbitListener(queues = MusicImportMessagingConfiguration.WORK_QUEUE)
    public void consume(Message message, Channel channel) throws IOException {
        long tag = message.getMessageProperties().getDeliveryTag();
        UUID id;
        try {
            JsonNode payload = JSON.readTree(new String(message.getBody(), StandardCharsets.UTF_8));
            if (payload.path("version").asInt() != 1) throw new IllegalArgumentException("未知消息版本");
            id = UUID.fromString(payload.path("jobId").asText());
        } catch (Exception ex) {
            LOGGER.warn("音频导入消息格式无效，送入死信队列", ex);
            channel.basicReject(tag, false);
            return;
        }

        Job job;
        try {
            job = jobs.claimJob(id);
            if (job == null) {
                Job current = jobs.find(id);
                if (current == null || "FAILED".equals(current.status())) channel.basicReject(tag, false);
                else if ("SUCCEEDED".equals(current.status())) channel.basicAck(tag, false);
                else {
                    // 另一次投递仍持有租约；稍后重试，避免在一首歌上并行写文件。
                    pause(2_000);
                    channel.basicNack(tag, false, true);
                }
                return;
            }
        } catch (Exception ex) {
            LOGGER.warn("领取音频任务失败，稍后重新投递: {}", id, ex);
            pause(5_000);
            channel.basicNack(tag, false, true);
            return;
        }

        // 首次领取时记录排队耗时；重试仍记录本次实际处理耗时，便于观察削峰效果。
        long processingStarted = System.nanoTime();
        long queueWaitMs = job.attemptCount() == 0
                ? Duration.between(job.createdAt(), OffsetDateTime.now(ZoneOffset.UTC)).toMillis() : -1;
        try {
            music.addStagedTrack(staging.file(id), job.originalFilename(), job.trackId());
            jobs.succeed(id);
            staging.delete(id);
            LOGGER.info("音频导入完成: jobId={} queueWaitMs={} processingMs={}", id, queueWaitMs,
                    Duration.ofNanos(System.nanoTime() - processingStarted).toMillis());
        } catch (Exception ex) {
            LOGGER.error("音频导入失败: jobId={} attempt={} queueWaitMs={} processingMs={}", id,
                    job.attemptCount() + 1, queueWaitMs,
                    Duration.ofNanos(System.nanoTime() - processingStarted).toMillis(), ex);
            boolean terminal;
            try {
                String code = ex instanceof BackendApiException api ? api.code() : "MUSIC_IMPORT_PROCESS_FAILED";
                terminal = jobs.failAttempt(id, code);
            } catch (Exception dbEx) {
                LOGGER.error("记录任务失败状态失败，消息仍需重投: {}", id, dbEx);
                pause(5_000);
                channel.basicNack(tag, false, true);
                return;
            }
            if (terminal) channel.basicReject(tag, false);
            else {
                pause(job.attemptCount() == 0 ? 1_000 : 3_000);
                channel.basicNack(tag, false, true);
            }
            return;
        }
        channel.basicAck(tag, false);
    }

    private static void pause(long millis) {
        try { Thread.sleep(millis); }
        catch (InterruptedException ex) { Thread.currentThread().interrupt(); }
    }
}
