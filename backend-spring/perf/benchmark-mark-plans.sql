\set ON_ERROR_STOP on
SET auto_explain.log_min_duration=-1;
-- One isolated logical snapshot. Product tables are read only.
CREATE SCHEMA perf_mark_plan_20260927;
CREATE TABLE perf_mark_plan_20260927.outbox AS SELECT * FROM public.article_metric_outbox;
ALTER TABLE perf_mark_plan_20260927.outbox SET (autovacuum_enabled=false);
ALTER TABLE perf_mark_plan_20260927.outbox ADD PRIMARY KEY(id);
CREATE INDEX bench_pending_schedule ON perf_mark_plan_20260927.outbox(next_attempt_at,created_at) WHERE published_at IS NULL;
ANALYZE perf_mark_plan_20260927.outbox;
INSERT INTO perf_mark_plan_20260927.outbox
SELECT gen_random_uuid(),'perf-article-1','VIEW',1::smallint,now(),now(),NULL,NULL,0
FROM generate_series(1,20000);
CREATE TEMP TABLE bench_targets AS SELECT id FROM perf_mark_plan_20260927.outbox WHERE published_at IS NULL ORDER BY id LIMIT 200;
CREATE FUNCTION perf_mark_plan_20260927.run(stage text) RETURNS SETOF json LANGUAGE plpgsql AS $$
DECLARE query text; p json; n int; pending bigint; published bigint;
BEGIN
 SELECT 'EXPLAIN (ANALYZE,BUFFERS,WAL,TIMING OFF,FORMAT JSON) UPDATE perf_mark_plan_20260927.outbox SET published_at=now(),claimed_until=NULL WHERE id IN (' || string_agg(quote_literal(id::text)::text,',') || ') AND published_at IS NULL' INTO query FROM bench_targets;
 FOR n IN 1..15 LOOP
  BEGIN
   EXECUTE query INTO p;
   RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='benchmark rollback';
  EXCEPTION WHEN no_data_found THEN
   -- Subtransaction rollback preserves the same logical rows for every sample.
  END;
  IF n>5 THEN RETURN NEXT json_build_object('stage',stage,'iteration',n-5,'plan',p); END IF;
 END LOOP;
 SELECT count(*) FILTER(WHERE published_at IS NULL),count(*) FILTER(WHERE published_at IS NOT NULL) INTO pending,published FROM perf_mark_plan_20260927.outbox;
 IF pending<>20000 THEN RAISE EXCEPTION 'Pending snapshot changed'; END IF;
 RETURN NEXT json_build_object('stage',stage,'pending',pending,'published',published,'nullFrac',(SELECT null_frac FROM pg_stats WHERE schemaname='perf_mark_plan_20260927' AND tablename='outbox' AND attname='published_at'));
END $$;
SELECT perf_mark_plan_20260927.run('A1-stale-existing')::jsonb;
CREATE INDEX bench_pending_id ON perf_mark_plan_20260927.outbox(id) WHERE published_at IS NULL;
SELECT perf_mark_plan_20260927.run('B1-stale-id-index')::jsonb;
SELECT perf_mark_plan_20260927.run('B2-stale-id-index')::jsonb;
DROP INDEX perf_mark_plan_20260927.bench_pending_id;
SELECT perf_mark_plan_20260927.run('A2-stale-existing')::jsonb;
ANALYZE perf_mark_plan_20260927.outbox;
SELECT perf_mark_plan_20260927.run('C-fresh-existing')::jsonb;
CREATE INDEX bench_pending_id ON perf_mark_plan_20260927.outbox(id) WHERE published_at IS NULL;
SELECT perf_mark_plan_20260927.run('D-fresh-id-index')::jsonb;
SELECT json_build_object('indexBytes',pg_relation_size('perf_mark_plan_20260927.bench_pending_id'),
 'pending', (SELECT count(*) FROM perf_mark_plan_20260927.outbox WHERE published_at IS NULL));
DROP SCHEMA perf_mark_plan_20260927 CASCADE;

