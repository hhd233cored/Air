\pset tuples_only on
\pset format unaligned
SET application_name='article-perf-wait-observer';
SET auto_explain.log_min_duration=-1;
SELECT json_build_object('atEpochMs',floor(extract(epoch FROM clock_timestamp())*1000),
 'backends',coalesce(json_agg(json_build_object('pid',pid,'state',state,
 'waitType',wait_event_type,'waitEvent',wait_event,
 'queryStartMs',floor(extract(epoch FROM query_start)*1000),
 'xactStartMs',floor(extract(epoch FROM xact_start)*1000),
 'kind',CASE
 WHEN query ~* '^\s*UPDATE article_metric_outbox SET published_at' THEN 'mark'
 WHEN query ~* '^\s*WITH ready AS' THEN 'claim'
 WHEN query ~* '^\s*WITH incoming\s*\(article_id,\s*view_delta,\s*refresh_likes\)' THEN 'stats'
 WHEN query ~* '^\s*COMMIT' THEN 'commit'
 WHEN query ~* '^\s*ROLLBACK' THEN 'rollback'
 ELSE 'other' END)),'[]'::json))
FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
AND (backend_type='client backend' OR backend_type='autovacuum worker');
\watch 0.02
