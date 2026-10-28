-- 只读核对：psql -v article_start=1 -v article_end=100 -At -f ...
-- 三个字段的 now() 是各事务起点，不是 COMMIT/Confirm/ACK 完成时刻。
-- processed - created 包含入口事务起点至消费 apply 事务起点的异步滞后；
-- 不含消费事务的执行/提交、缓存失效和 ACK。消费可能先于批量 published 标记。
WITH selected AS (
    SELECT 'perf-article-' || n AS id FROM generate_series(:article_start, :article_end) n
), events AS (
    SELECT o.metric_type, o.attempt_count, o.published_at, p.processed_at,
           extract(epoch FROM (o.published_at-o.created_at))*1000 AS publish_ms,
           extract(epoch FROM (p.processed_at-o.created_at))*1000 AS apply_start_ms,
           extract(epoch FROM (p.processed_at-o.published_at))*1000 AS apply_minus_mark_ms
    FROM article_metric_outbox o
    JOIN selected s ON s.id=o.article_id
    LEFT JOIN article_metric_processed p ON p.event_id=o.id
)
SELECT json_build_object(
    'metricType',coalesce(metric_type,'ALL'),
    'events',count(*),'published',count(published_at),'processed',count(processed_at),
    'retried',count(*) FILTER(WHERE attempt_count>0),'totalAttempts',coalesce(sum(attempt_count),0),'maxAttempts',max(attempt_count),
    'publishLagMs',json_build_object(
        'mean',round(avg(publish_ms),3),'min',round(min(publish_ms),3),
        'p50',round((percentile_cont(0.5) WITHIN GROUP(ORDER BY publish_ms))::numeric,3),
        'p95',round((percentile_cont(0.95) WITHIN GROUP(ORDER BY publish_ms))::numeric,3),
        'p99',round((percentile_cont(0.99) WITHIN GROUP(ORDER BY publish_ms))::numeric,3),
        'max',round(max(publish_ms),3)),
    'applyStartLagMs',json_build_object(
        'mean',round(avg(apply_start_ms),3),'min',round(min(apply_start_ms),3),
        'p50',round((percentile_cont(0.5) WITHIN GROUP(ORDER BY apply_start_ms))::numeric,3),
        'p95',round((percentile_cont(0.95) WITHIN GROUP(ORDER BY apply_start_ms))::numeric,3),
        'p99',round((percentile_cont(0.99) WITHIN GROUP(ORDER BY apply_start_ms))::numeric,3),
        'max',round(max(apply_start_ms),3)),
    'applyBeforePublishedMark',count(*) FILTER(WHERE apply_minus_mark_ms<0),
    'negativeApplyStartLag',count(*) FILTER(WHERE apply_start_ms<0)
)
FROM events GROUP BY GROUPING SETS ((metric_type),()) ORDER BY metric_type NULLS LAST;
