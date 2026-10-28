package org.airchord.backend.metrics;

import org.airchord.backend.web.BackendApiException;
import org.airchord.backend.web.ContentNotFoundException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.postgresql.PGStatement;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.TreeMap;
import java.util.HashSet;
import java.util.UUID;
import java.util.Collections;

/** 点赞与浏览的事实、待发布事件和统计读模型都由 PostgreSQL 保存。 */
@Repository
public class ArticleMetricRepository {
    private final JdbcClient jdbc;
    private final JdbcTemplate jdbcTemplate;
    private final boolean markServerPrepareDisabled;

    public ArticleMetricRepository(JdbcClient jdbc, JdbcTemplate jdbcTemplate,
            @Value("${airchord.article-metric.mark-server-prepare-disabled:false}") boolean markServerPrepareDisabled) {
        this.jdbc = jdbc;
        this.jdbcTemplate = jdbcTemplate;
        this.markServerPrepareDisabled = markServerPrepareDisabled;
    }

    public String publishedArticleId(String slug) {
        return jdbc.sql("""
                SELECT id FROM content_items
                WHERE content_type = 'ARTICLE' AND lower(trim(slug)) = lower(trim(:slug))
                  AND status = 'PUBLISHED' AND deleted_at IS NULL
                """).param("slug", slug).query(String.class).optional()
                .orElseThrow(() -> new ContentNotFoundException("ARTICLE_NOT_FOUND", "Article not found: " + slug));
    }

    /** 相同事件 ID 的网络重试不再记一次浏览；行为与 outbox 在同一事务提交。 */
    @Transactional
    public boolean recordView(String articleId, UUID eventId, Long userId) {
        long factStart = System.nanoTime();
        int inserted = jdbc.sql("""
                INSERT INTO article_view_events (id, article_id, user_id)
                VALUES (:id, :articleId, CAST(:userId AS bigint)) ON CONFLICT (id) DO NOTHING
                """).param("id", eventId).param("articleId", articleId).param("userId", userId).update();
        ArticleMetricTiming.fact(System.nanoTime() - factStart);
        if (inserted == 0) {
            String previous = jdbc.sql("SELECT article_id FROM article_view_events WHERE id = :id")
                    .param("id", eventId).query(String.class).single();
            if (!articleId.equals(previous))
                throw new BackendApiException("VIEW_EVENT_CONFLICT", "Event ID belongs to another article", 409);
            return false;
        }
        appendEvent(articleId, "VIEW", 1);
        ArticleMetricTiming.observeCommit();
        return true;
    }

    /** 数据库唯一键是最终防重依据；重复点击不会创建新的计数事件。 */
    @Transactional
    public boolean like(String articleId, long userId) {
        long factStart = System.nanoTime();
        int inserted = jdbc.sql("""
                INSERT INTO article_likes (article_id, user_id) VALUES (:articleId, :userId)
                ON CONFLICT (article_id, user_id) DO NOTHING
                """).param("articleId", articleId).param("userId", userId).update();
        ArticleMetricTiming.fact(System.nanoTime() - factStart);
        if (inserted == 1) {
            appendEvent(articleId, "LIKE", 1);
            ArticleMetricTiming.observeCommit();
        }
        return inserted == 1;
    }

    @Transactional
    public boolean unlike(String articleId, long userId) {
        long factStart = System.nanoTime();
        int deleted = jdbc.sql("DELETE FROM article_likes WHERE article_id = :articleId AND user_id = :userId")
                .param("articleId", articleId).param("userId", userId).update();
        ArticleMetricTiming.fact(System.nanoTime() - factStart);
        if (deleted == 1) {
            appendEvent(articleId, "LIKE", -1);
            ArticleMetricTiming.observeCommit();
        }
        return deleted == 1;
    }

    public boolean likedBy(String articleId, long userId) {
        return jdbc.sql("SELECT EXISTS(SELECT 1 FROM article_likes WHERE article_id = :articleId AND user_id = :userId)")
                .param("articleId", articleId).param("userId", userId).query(Boolean.class).single();
    }

    public Counts counts(String articleId) {
        return jdbc.sql("SELECT view_count, like_count, updated_at FROM article_stats WHERE article_id = :articleId")
                .param("articleId", articleId).query((rs, row) -> new Counts(rs.getLong("view_count"),
                        rs.getLong("like_count"), rs.getObject("updated_at", OffsetDateTime.class).toInstant().toString()))
                .optional().orElse(new Counts(0, 0, null));
    }

    private void appendEvent(String articleId, String type, int delta) {
        long outboxStart = System.nanoTime();
        jdbc.sql("INSERT INTO article_metric_outbox (id, article_id, metric_type, delta) VALUES (:id, :articleId, :type, :delta)")
                .param("id", UUID.randomUUID()).param("articleId", articleId)
                .param("type", type).param("delta", delta).update();
        ArticleMetricTiming.outbox(System.nanoTime() - outboxStart);
    }

    /** 短租约和 SKIP LOCKED 允许发布器重启后找回未确认的事件。 */
    @Transactional
    public List<Event> claimOutbox(int limit) {
        return jdbc.sql("""
                WITH ready AS (
                    SELECT id FROM article_metric_outbox
                    WHERE published_at IS NULL AND next_attempt_at <= now()
                      AND (claimed_until IS NULL OR claimed_until < now())
                    ORDER BY created_at, id LIMIT :limit FOR UPDATE SKIP LOCKED
                )
                UPDATE article_metric_outbox o SET claimed_until = now() + interval '30 seconds'
                FROM ready WHERE o.id = ready.id
                RETURNING o.id, o.article_id, o.metric_type, o.delta
                """).param("limit", limit).query(this::mapEvent).list();
    }

    /** 仅接收已确认且未被 Return 的事件；一条 UPDATE、一次提交，重复标记无副作用。 */
    @Transactional
    public int markPublishedBatch(List<UUID> ids) {
        if (ids.isEmpty()) return 0;
        String sql = """
                UPDATE article_metric_outbox SET published_at = now(), claimed_until = NULL
                WHERE id IN (%s) AND published_at IS NULL
                """.formatted(String.join(", ", Collections.nCopies(ids.size(), "?")));
        return jdbcTemplate.update(connection -> {
            var statement = connection.prepareStatement(sql);
            try {
                // This bulk IN filter can get a costly generic plan when pending statistics lag.
                // Keep UUID binding and change only this statement's server-prepare policy.
                if (markServerPrepareDisabled) statement.unwrap(PGStatement.class).setPrepareThreshold(0);
                for (int index = 0; index < ids.size(); index++) statement.setObject(index + 1, ids.get(index));
                return statement;
            } catch (SQLException | RuntimeException failure) {
                try { statement.close(); } catch (SQLException closeFailure) { failure.addSuppressed(closeFailure); }
                throw failure;
            }
        });
    }

    public void defer(UUID id) {
        jdbc.sql("""
                UPDATE article_metric_outbox SET attempt_count = attempt_count + 1, claimed_until = NULL,
                    next_attempt_at = now() + interval '2 seconds'
                WHERE id = :id AND published_at IS NULL
                """).param("id", id).update();
    }

    public Event event(UUID id) {
        return jdbc.sql("SELECT id, article_id, metric_type, delta FROM article_metric_outbox WHERE id = :id")
                .param("id", id).query(this::mapEvent).optional().orElse(null);
    }

    public List<Event> events(List<UUID> ids) {
        if (ids.isEmpty()) return List.of();
        return jdbc.sql("SELECT id, article_id, metric_type, delta FROM article_metric_outbox WHERE id IN (:ids)")
                .param("ids", ids).query(this::mapEvent).list();
    }

    /** 每批一次提交、一条统计 UPSERT；只合并首次处理的事件，文章更新按 ID 排序。 */
    @Transactional
    public BatchApplied applyBatch(List<Event> events) {
        boolean timing = ArticleMetricConsumerTiming.active();
        long bodyStarted = timing ? System.nanoTime() : 0;
        ArticleMetricConsumerTiming.observeCommit();
        try {
            var unique = new TreeMap<UUID, Event>();
            for (var event : events) {
                if (!"VIEW".equals(event.metricType()) && !"LIKE".equals(event.metricType()))
                    throw new IllegalArgumentException("Unknown metric type: " + event.metricType());
                unique.putIfAbsent(event.id(), event);
            }
            if (unique.isEmpty()) return new BatchApplied(List.of(), List.of(), 0, 0);
            var parameters = new LinkedHashMap<String, Object>();
            var values = new ArrayList<String>();
            for (var id : unique.keySet()) {
                String name = "id" + parameters.size();
                parameters.put(name, id);
                values.add("(:" + name + ")");
            }
            long processedStarted = timing ? System.nanoTime() : 0;
            List<UUID> inserted;
            try {
                inserted = jdbc.sql("INSERT INTO article_metric_processed (event_id) VALUES "
                        + String.join(",", values) + " ON CONFLICT DO NOTHING RETURNING event_id")
                        .params(parameters).query(UUID.class).list();
            } finally {
                if (timing) ArticleMetricConsumerTiming.processedSql(System.nanoTime() - processedStarted);
            }
            var views = new TreeMap<String, Long>();
            var likes = new HashSet<String>();
            int viewEvents = 0, likeEvents = 0;
            for (var id : inserted) {
                var event = unique.get(id);
                views.putIfAbsent(event.articleId(), 0L);
                if ("VIEW".equals(event.metricType())) {
                    // 延续单条消费语义：每个浏览事件计一次，不用点赞的 +/-1 增量。
                    views.merge(event.articleId(), 1L, Long::sum);
                    viewEvents++;
                } else {
                    likes.add(event.articleId());
                    likeEvents++;
                }
            }
            long statsStarted = timing ? System.nanoTime() : 0;
            try {
                var statsParameters = new LinkedHashMap<String, Object>();
                var statsValues = new ArrayList<String>();
                for (var article : views.entrySet()) {
                    int index = statsValues.size();
                    statsParameters.put("article" + index, article.getKey());
                    statsParameters.put("views" + index, article.getValue());
                    statsParameters.put("likes" + index, likes.contains(article.getKey()));
                    statsValues.add("(CAST(:article" + index + " AS varchar), CAST(:views" + index
                            + " AS bigint), CAST(:likes" + index + " AS boolean))");
                }
                if (!statsValues.isEmpty()) {
                    // 每篇仅一行、按 ID 获取统计行锁；VIEW 合并增量，LIKE 仍从关系事实重算。
                    // 刷新标志留在 CTE，避免纯 VIEW 批次用默认 0 覆盖已存在的点赞数。
                    jdbc.sql("""
                            WITH incoming(article_id, view_delta, refresh_likes) AS (VALUES
                            """ + String.join(",", statsValues) + """
                            )
                            INSERT INTO article_stats (article_id, view_count, like_count)
                            SELECT i.article_id, i.view_delta, CASE WHEN i.refresh_likes THEN
                                (SELECT count(*) FROM article_likes l WHERE l.article_id = i.article_id)
                                ELSE 0 END
                            FROM incoming i ORDER BY i.article_id
                            ON CONFLICT (article_id) DO UPDATE SET
                                view_count = article_stats.view_count + EXCLUDED.view_count,
                                like_count = CASE WHEN (SELECT i.refresh_likes FROM incoming i
                                    WHERE i.article_id = EXCLUDED.article_id) THEN EXCLUDED.like_count
                                    ELSE article_stats.like_count END, updated_at = now()
                            """).params(statsParameters).update();
                }
            } finally {
                if (timing && !views.isEmpty()) ArticleMetricConsumerTiming.statsSql(System.nanoTime() - statsStarted);
            }
            return new BatchApplied(List.copyOf(inserted), List.copyOf(views.keySet()), viewEvents, likeEvents);
        } finally {
            if (timing) ArticleMetricConsumerTiming.applyBody(System.nanoTime() - bodyStarted);
        }
    }

    /** 处理标记和计数在同一事务；ACK 丢失时重投也不会再更新。 */
    @Transactional
    public boolean apply(Event event) {
        boolean timing = ArticleMetricConsumerTiming.active();
        long bodyStarted = timing ? System.nanoTime() : 0;
        ArticleMetricConsumerTiming.observeCommit();
        try {
            long processedStarted = timing ? System.nanoTime() : 0;
            int first;
            try {
                first = jdbc.sql("INSERT INTO article_metric_processed (event_id) VALUES (:id) ON CONFLICT DO NOTHING")
                        .param("id", event.id()).update();
            } finally {
                if (timing) ArticleMetricConsumerTiming.processedSql(System.nanoTime() - processedStarted);
            }
            if (first == 0) return false;
            long statsStarted = timing ? System.nanoTime() : 0;
            try {
                if ("VIEW".equals(event.metricType())) {
                    jdbc.sql("""
                            INSERT INTO article_stats (article_id, view_count) VALUES (:articleId, 1)
                            ON CONFLICT (article_id) DO UPDATE SET
                                view_count = article_stats.view_count + 1, updated_at = now()
                            """).param("articleId", event.articleId()).update();
                } else {
                    // 取消赞和重新点赞的消息可能乱序；从点赞关系重算，避免先消费 -1 时出现负数。
                    jdbc.sql("""
                            INSERT INTO article_stats (article_id, like_count)
                            VALUES (:articleId, (SELECT count(*) FROM article_likes WHERE article_id = :articleId))
                            ON CONFLICT (article_id) DO UPDATE SET
                                like_count = (SELECT count(*) FROM article_likes WHERE article_id = :articleId),
                                updated_at = now()
                            """).param("articleId", event.articleId()).update();
                }
            } finally {
                if (timing) ArticleMetricConsumerTiming.statsSql(System.nanoTime() - statsStarted);
            }
            return true;
        } finally {
            if (timing) ArticleMetricConsumerTiming.applyBody(System.nanoTime() - bodyStarted);
        }
    }

    private Event mapEvent(ResultSet rs, int row) throws SQLException {
        return new Event(rs.getObject("id", UUID.class), rs.getString("article_id"),
                rs.getString("metric_type"), rs.getInt("delta"));
    }

    public record Event(UUID id, String articleId, String metricType, int delta) { }
    public record BatchApplied(List<UUID> eventIds, List<String> articleIds, int viewEvents, int likeEvents) { }
    public record Counts(long viewCount, long likeCount, String updatedAt) { }
}
