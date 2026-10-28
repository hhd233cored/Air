package org.airchord.backend.music;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/** PostgreSQL 是任务与 outbox 的事实来源；RabbitMQ 只传递待处理任务 ID。 */
@Repository
public class MusicImportRepository {
    private static final String JOB_COLUMNS = "id, track_id, original_filename, staged_bytes, status, "
            + "attempt_count, error_code, created_at, updated_at, finished_at";
    private final JdbcClient jdbc;
    private final int maxJobs;
    private final long maxStagingBytes;

    public MusicImportRepository(JdbcClient jdbc,
                                 @Value("${airchord.music.import-max-jobs:20}") int maxJobs,
                                 @Value("${airchord.music.import-max-staging-bytes:1073741824}") long maxStagingBytes) {
        this.jdbc = jdbc;
        this.maxJobs = maxJobs;
        this.maxStagingBytes = maxStagingBytes;
    }

    /** 使用事务级 advisory lock 串行化容量检查，防止并发上传同时越过 20 个任务上限。 */
    @Transactional
    public Job enqueue(UUID id, String trackId, long actorId, String filename, long bytes) {
        jdbc.sql("SELECT pg_advisory_xact_lock(82024091)").query((rs, row) -> true).single();
        Usage usage = jdbc.sql("""
                SELECT COUNT(*) AS jobs, COALESCE(SUM(staged_bytes), 0) AS bytes
                FROM music_import_jobs WHERE status IN ('PENDING', 'RUNNING')
                """).query((rs, row) -> new Usage(rs.getLong("jobs"), rs.getLong("bytes"))).single();
        if (usage.jobs >= maxJobs || bytes > maxStagingBytes - usage.bytes)
            throw new MusicImportCapacityException();
        jdbc.sql("""
                INSERT INTO music_import_jobs
                  (id, track_id, actor_user_id, original_filename, staged_bytes, status)
                VALUES (:id, :trackId, :actorId, :filename, :bytes, 'PENDING')
                """).param("id", id).param("trackId", trackId).param("actorId", actorId)
                .param("filename", filename).param("bytes", bytes).update();
        // 与任务一同提交；如果 RabbitMQ 断开，定时发布器会从此表继续发送。
        jdbc.sql("INSERT INTO music_import_outbox (id, job_id) VALUES (:id, :jobId)")
                .param("id", UUID.randomUUID()).param("jobId", id).update();
        return find(id);
    }

    public Job find(UUID id) {
        return jdbc.sql("SELECT " + JOB_COLUMNS + " FROM music_import_jobs WHERE id = :id")
                .param("id", id).query(this::mapJob).optional().orElse(null);
    }

    /** 消费者取得有时限的租约，避免重复投递同时写同一首歌。 */
    public Job claimJob(UUID id) {
        return jdbc.sql("""
                UPDATE music_import_jobs
                SET status = 'RUNNING', lease_until = now() + interval '10 minutes', updated_at = now()
                WHERE id = :id AND (status = 'PENDING' OR (status = 'RUNNING' AND lease_until < now()))
                RETURNING """ + " " + JOB_COLUMNS)
                .param("id", id).query(this::mapJob).optional().orElse(null);
    }

    public void succeed(UUID id) {
        jdbc.sql("""
                UPDATE music_import_jobs
                SET status = 'SUCCEEDED', lease_until = NULL, error_code = NULL,
                    updated_at = now(), finished_at = now()
                WHERE id = :id AND status = 'RUNNING'
                """).param("id", id).update();
    }

    /** 一次失败只计一次；第三次失败转为终态，让消息进入死信队列。 */
    public boolean failAttempt(UUID id, String errorCode) {
        String status = jdbc.sql("""
                UPDATE music_import_jobs
                SET attempt_count = attempt_count + 1,
                    status = CASE WHEN attempt_count + 1 >= 3 THEN 'FAILED' ELSE 'PENDING' END,
                    error_code = :errorCode, lease_until = NULL, updated_at = now(),
                    finished_at = CASE WHEN attempt_count + 1 >= 3 THEN now() ELSE NULL END
                WHERE id = :id AND status = 'RUNNING'
                RETURNING status
                """).param("id", id).param("errorCode", errorCode)
                .query(String.class).optional().orElse(null);
        return "FAILED".equals(status);
    }

    /** 重启时原进程已不存在；RabbitMQ 会重新投递未确认的消息。 */
    public void resetRunningAfterRestart(OffsetDateTime processStartedAt) {
        jdbc.sql("""
                UPDATE music_import_jobs SET status = 'PENDING', lease_until = NULL, updated_at = now()
                WHERE status = 'RUNNING' AND updated_at < :startedAt
                """).param("startedAt", processStartedAt).update();
    }

    /** 领取后立即提交事务，不在等待 RabbitMQ 确认时占用数据库连接。 */
    @Transactional
    public List<OutboxEvent> claimOutbox() {
        return jdbc.sql("""
                WITH ready AS (
                    SELECT id FROM music_import_outbox
                    WHERE published_at IS NULL AND next_attempt_at <= now()
                      AND (claimed_until IS NULL OR claimed_until < now())
                    ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED
                )
                UPDATE music_import_outbox o
                SET claimed_until = now() + interval '30 seconds'
                FROM ready WHERE o.id = ready.id
                RETURNING o.id, o.job_id
                """).query((rs, row) -> new OutboxEvent(rs.getObject("id", UUID.class),
                rs.getObject("job_id", UUID.class))).list();
    }

    public void markPublished(UUID eventId) {
        jdbc.sql("""
                UPDATE music_import_outbox SET published_at = now(), claimed_until = NULL
                WHERE id = :id AND published_at IS NULL
                """).param("id", eventId).update();
    }

    public void deferOutbox(UUID eventId) {
        jdbc.sql("""
                UPDATE music_import_outbox
                SET attempt_count = attempt_count + 1, claimed_until = NULL,
                    next_attempt_at = now() + interval '5 seconds'
                WHERE id = :id AND published_at IS NULL
                """).param("id", eventId).update();
    }

    /** 成功文件立即清理；失败文件保留 7 天；没有数据库任务的残留文件保留 24 小时。 */
    public boolean mayDeleteStaged(UUID id, OffsetDateTime fileModifiedAt) {
        return jdbc.sql("SELECT status, finished_at FROM music_import_jobs WHERE id = :id")
                .param("id", id).query((rs, row) -> {
                    String status = rs.getString("status");
                    OffsetDateTime finished = rs.getObject("finished_at", OffsetDateTime.class);
                    return "SUCCEEDED".equals(status) || ("FAILED".equals(status) && finished != null
                            && finished.isBefore(OffsetDateTime.now().minusDays(7)));
                }).optional().orElseGet(() -> fileModifiedAt.isBefore(OffsetDateTime.now().minusDays(1)));
    }

    private Job mapJob(ResultSet rs, int row) throws SQLException {
        return new Job(rs.getObject("id", UUID.class), rs.getString("track_id"),
                rs.getString("original_filename"), rs.getLong("staged_bytes"), rs.getString("status"),
                rs.getInt("attempt_count"), rs.getString("error_code"),
                rs.getObject("created_at", OffsetDateTime.class),
                rs.getObject("updated_at", OffsetDateTime.class),
                rs.getObject("finished_at", OffsetDateTime.class));
    }

    public record Job(UUID id, String trackId, String originalFilename, long stagedBytes, String status,
                      int attemptCount, String errorCode, OffsetDateTime createdAt,
                      OffsetDateTime updatedAt, OffsetDateTime finishedAt) { }
    public record OutboxEvent(UUID id, UUID jobId) { }
    private record Usage(long jobs, long bytes) { }
}
