package org.airchord.backend.metrics;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import javax.sql.DataSource;
import java.sql.SQLException;

/** 只在隔离压测显式开启计时时提供采样；沿用正常的登录鉴权。 */
@RestController
@ConditionalOnProperty(name = "airchord.perf-timing-enabled", havingValue = "true")
public class ArticleMetricPerfProbeController {
    private final HikariDataSource dataSource;
    private final HikariDataSource backgroundDataSource;
    private final JdbcClient jdbc;
    private final ArticleMetricPerfTomcatConfiguration tomcat;

    public ArticleMetricPerfProbeController(DataSource dataSource, JdbcClient jdbc,
            ArticleMetricPerfTomcatConfiguration tomcat) throws SQLException {
        this.dataSource = dataSource.unwrap(HikariDataSource.class);
        this.backgroundDataSource = dataSource instanceof ArticleMetricSplitDataSource split ? split.backgroundPool() : null;
        this.jdbc = jdbc;
        this.tomcat = tomcat;
    }

    @GetMapping("/api/v1/perf/article-metrics-waits")
    public Snapshot snapshot() {
        var pool = dataSource.getHikariPoolMXBean();
        int active = pool == null ? 0 : pool.getActiveConnections();
        int idle = pool == null ? 0 : pool.getIdleConnections();
        int pending = pool == null ? 0 : pool.getThreadsAwaitingConnection();
        var threads = tomcat.threads();
        long queryStart = System.nanoTime();
        var waits = jdbc.sql("""
                SELECT count(*) FILTER (WHERE state = 'active') AS active,
                       count(*) FILTER (WHERE wait_event_type = 'Lock') AS lock_wait,
                       count(*) FILTER (WHERE wait_event_type = 'IO') AS io_wait,
                       count(*) FILTER (WHERE wait_event_type = 'Client') AS client_wait,
                       count(*) FILTER (WHERE state = 'active' AND wait_event_type IS NOT NULL
                           AND wait_event_type NOT IN ('Lock', 'IO', 'Client')) AS other_wait,
                       (SELECT count(*) FROM article_metric_outbox WHERE published_at IS NULL) AS outbox_pending,
                       COALESCE(string_agg(DISTINCT wait_event_type || ':' || wait_event, ',')
                           FILTER (WHERE state = 'active' AND wait_event_type IS NOT NULL), '') AS wait_events
                FROM pg_stat_activity
                WHERE datname = current_database() AND pid <> pg_backend_pid()
                """).query((rs, row) -> new Waits(rs.getLong("active"), rs.getLong("lock_wait"),
                rs.getLong("io_wait"), rs.getLong("client_wait"), rs.getLong("outbox_pending"),
                rs.getLong("other_wait"),
                rs.getString("wait_events"))).single();
        return new Snapshot(System.currentTimeMillis(), active, idle, pending, waits.outboxPending(),
                (System.nanoTime() - queryStart) / 1_000_000.0,
                waits.active(), waits.lockWait(), waits.ioWait(), waits.clientWait(), waits.otherWait(),
                waits.waitEvents(), dataSource.getMaximumPoolSize(), dataSource.getMinimumIdle(),threads,
                poolSnapshot(backgroundDataSource));
    }

    public record Snapshot(long sampledAtEpochMs, int poolActive, int poolIdle, int poolPending,
                           long outboxPending,
                           double dbProbeMs, long dbActive, long dbLockWait, long dbIoWait,
                           long dbClientWait, long dbOtherWait, String dbWaitEvents,
                           int poolMaximum, int poolMinimumIdle,
                           ArticleMetricPerfTomcatConfiguration.ThreadSnapshot tomcatThreads,
                           PoolSnapshot backgroundPool) { }

    private static PoolSnapshot poolSnapshot(HikariDataSource source) {
        if (source == null) return null;
        var pool = source.getHikariPoolMXBean();
        return new PoolSnapshot(source.getMaximumPoolSize(), source.getMinimumIdle(),
                pool == null ? 0 : pool.getActiveConnections(), pool == null ? 0 : pool.getIdleConnections(),
                pool == null ? 0 : pool.getThreadsAwaitingConnection());
    }
    public record PoolSnapshot(int maximum, int minimumIdle, int active, int idle, int pending) { }

    private record Waits(long active, long lockWait, long ioWait, long clientWait,
                         long outboxPending,
                         long otherWait, String waitEvents) { }
}
