package org.airchord.backend.metrics;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;
import java.util.Map;

/** PostgreSQL 18 cumulative counters; no reset, no query text or bind values. */
@RestController
@ConditionalOnProperty(name = {"airchord.perf-timing-enabled", "airchord.perf-pg-enabled"}, havingValue = "true")
public class ArticleMetricPerfPostgresController {
    private final JdbcClient jdbc;
    public ArticleMetricPerfPostgresController(JdbcClient jdbc) { this.jdbc = jdbc; }

    @GetMapping("/api/v1/perf/article-metrics-postgres")
    public Snapshot snapshot() {
        long started = System.currentTimeMillis();
        var settings = jdbc.sql("""
            SELECT name, setting FROM pg_settings WHERE name IN
              ('server_version','fsync','synchronous_commit','wal_sync_method',
               'track_io_timing','track_wal_io_timing','max_connections') ORDER BY name
            """).query().listOfRows();
        var wal = jdbc.sql("SELECT * FROM pg_stat_wal").query().singleRow();
        var io = jdbc.sql("SELECT * FROM pg_stat_io ORDER BY backend_type, object, context").query().listOfRows();
        var database = jdbc.sql("""
            SELECT xact_commit,xact_rollback,blks_read,blks_hit,blk_read_time,blk_write_time,
                deadlocks,temp_bytes,stats_reset FROM pg_stat_database WHERE datname=current_database()
            """).query().singleRow();
        var checkpoints = jdbc.sql("SELECT * FROM pg_stat_checkpointer").query().singleRow();
        var statements = jdbc.sql("""
            SELECT CASE
              WHEN query ~* 'pg_stat_|pg_settings' THEN 'probe'
              WHEN lower(query) ~ '^commit' THEN 'commit'
              WHEN lower(query) ~ '^rollback' THEN 'rollback'
              WHEN query ~* 'article_metric_processed' THEN 'processed'
              WHEN query ~* 'article_stats' THEN 'stats'
              WHEN query ~* 'article_metric_outbox' THEN 'outbox'
              WHEN query ~* 'article_view_events|article_likes' THEN 'fact'
              WHEN query ~* '\\musers\\M' THEN 'account'
              WHEN query ~* 'content_items' THEN 'article'
              ELSE 'other' END AS category,
              sum(calls) AS calls, sum(total_exec_time) AS exec_ms, sum(rows) AS rows,
              sum(wal_bytes) AS wal_bytes
            FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
            GROUP BY 1 ORDER BY 1
            """).query().listOfRows();
        var statementInfo = jdbc.sql("SELECT * FROM pg_stat_statements_info").query().singleRow();
        return new Snapshot(started, System.currentTimeMillis(), settings, wal, io, database, checkpoints,
                statements, statementInfo);
    }
    public record Snapshot(long startedAtEpochMs, long endedAtEpochMs, List<Map<String,Object>> settings,
            Map<String,Object> wal, List<Map<String,Object>> io, Map<String,Object> database,
            Map<String,Object> checkpoints, List<Map<String,Object>> statements, Map<String,Object> statementInfo) {}
}
