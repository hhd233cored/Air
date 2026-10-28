\set ON_ERROR_STOP on
SET auto_explain.log_min_duration=-1;
SET statement_timeout='60s';
CREATE SCHEMA perf_stats_components_20260927;
-- Fixed late-load cohort: 64 existing rows, 48 refresh-likes flags, each view delta=1.
CREATE TEMP TABLE stats_input AS
SELECT 'perf-article-'||n article_id,1::bigint view_delta,(n-1201)%4<>0 refresh_likes,
 s.view_count before_views,s.like_count before_likes,s.updated_at before_updated,
 (SELECT count(*) FROM public.article_likes l WHERE l.article_id=s.article_id) fact_likes
FROM generate_series(1201,1264)n JOIN public.article_stats s ON s.article_id='perf-article-'||n;
DO $$ BEGIN
 IF (SELECT count(*) FROM stats_input)<>64 OR EXISTS(SELECT FROM stats_input WHERE before_likes<>fact_likes)
 THEN RAISE EXCEPTION 'Cohort missing or inconsistent';END IF;
END $$;
CREATE TABLE perf_stats_components_20260927.queries(mode text PRIMARY KEY,sql text,writes boolean);
DO $$ DECLARE v text;pc text;wo text;prefix text;BEGIN
 SELECT string_agg(format('(%L::varchar,1::bigint,%L::boolean)',article_id,refresh_likes),',' ORDER BY article_id),
 string_agg(format('(%L::varchar,1::bigint,%L::boolean,%s::bigint)',article_id,refresh_likes,fact_likes),',' ORDER BY article_id),
 string_agg(format('(%L::varchar,1::bigint,%s::bigint)',article_id,before_likes),',' ORDER BY article_id)
 INTO v,pc,wo FROM stats_input;
 prefix:='WITH incoming(article_id,view_delta,refresh_likes) AS (VALUES '||v||') ';
 INSERT INTO perf_stats_components_20260927.queries VALUES
 ('full',prefix||'INSERT INTO public.article_stats(article_id,view_count,like_count)
 SELECT i.article_id,i.view_delta,CASE WHEN i.refresh_likes THEN
 (SELECT count(*) FROM public.article_likes l WHERE l.article_id=i.article_id) ELSE 0 END
 FROM incoming i ORDER BY i.article_id
 ON CONFLICT(article_id) DO UPDATE SET view_count=article_stats.view_count+EXCLUDED.view_count,
 like_count=CASE WHEN(SELECT i.refresh_likes FROM incoming i WHERE i.article_id=EXCLUDED.article_id)
 THEN EXCLUDED.like_count ELSE article_stats.like_count END,updated_at=now()',true),
 ('count-only','WITH incoming(article_id,view_delta,refresh_likes) AS MATERIALIZED (VALUES '||v||')
 SELECT i.article_id,i.view_delta,CASE WHEN i.refresh_likes THEN
 (SELECT count(*) FROM public.article_likes l WHERE l.article_id=i.article_id) ELSE 0 END
 FROM incoming i ORDER BY i.article_id',false),
 ('precount-upsert','WITH incoming(article_id,view_delta,refresh_likes,likes) AS (VALUES '||pc||')
 INSERT INTO public.article_stats(article_id,view_count,like_count)
 SELECT i.article_id,i.view_delta,CASE WHEN i.refresh_likes THEN i.likes ELSE 0 END
 FROM incoming i ORDER BY i.article_id
 ON CONFLICT(article_id) DO UPDATE SET view_count=article_stats.view_count+EXCLUDED.view_count,
 like_count=CASE WHEN(SELECT i.refresh_likes FROM incoming i WHERE i.article_id=EXCLUDED.article_id)
 THEN EXCLUDED.like_count ELSE article_stats.like_count END,updated_at=now()',true),
 ('write-only','WITH incoming(article_id,view_delta,likes) AS (VALUES '||wo||')
 INSERT INTO public.article_stats(article_id,view_count,like_count)
 SELECT article_id,view_delta,likes FROM incoming ORDER BY article_id
 ON CONFLICT(article_id) DO UPDATE SET view_count=article_stats.view_count+EXCLUDED.view_count,
 like_count=EXCLUDED.like_count,updated_at=now()',true);
END $$;
CREATE FUNCTION perf_stats_components_20260927.run(stage text,timed boolean) RETURNS SETOF json LANGUAGE plpgsql AS $$
DECLARE n int;variant text;q text;p json;writing boolean;bad bigint;BEGIN
 FOR n IN 1..15 LOOP
  -- Rotate order to reduce cache/order bias; warmups and measurements interleave variants.
  FOR variant IN SELECT mode FROM perf_stats_components_20260927.queries
   ORDER BY mod(array_position(ARRAY['full','count-only','precount-upsert','write-only'],mode)+n,4) LOOP
   SELECT sql,writes INTO q,writing FROM perf_stats_components_20260927.queries WHERE mode=variant;
   BEGIN
    EXECUTE 'EXPLAIN(ANALYZE,BUFFERS,WAL,TIMING '||CASE WHEN timed THEN 'ON' ELSE 'OFF' END||',FORMAT JSON) '||q INTO p;
    SELECT count(*) INTO bad FROM stats_input i JOIN public.article_stats s USING(article_id)
     WHERE s.view_count<>i.before_views+CASE WHEN writing THEN 1 ELSE 0 END OR s.like_count<>i.before_likes;
    IF bad<>0 THEN RAISE EXCEPTION 'Transient result incorrect';END IF;
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='benchmark rollback';
   EXCEPTION WHEN no_data_found THEN NULL;
   END;
   IF EXISTS(SELECT FROM stats_input i JOIN public.article_stats s USING(article_id)
    WHERE s.view_count<>i.before_views OR s.like_count<>i.before_likes OR s.updated_at<>i.before_updated)
   THEN RAISE EXCEPTION 'Rollback changed cohort';END IF;
   IF n>5 THEN RETURN NEXT json_build_object('stage',stage,'timing',timed,'mode',variant,'iteration',n-5,'plan',p,'checks','PASS');END IF;
  END LOOP;
 END LOOP;
END $$;
SELECT json_build_object('event','baseline','articles',count(*),'refreshArticles',count(*)FILTER(WHERE refresh_likes),'cohortLikes',sum(fact_likes),'minLikes',min(fact_likes),'maxLikes',max(fact_likes),'visibility',(SELECT json_build_object('pages',relpages,'allVisible',relallvisible,'tuples',reltuples) FROM pg_class WHERE oid='public.article_likes'::regclass),'likeStats',(SELECT row_to_json(s) FROM(SELECT n_live_tup,n_dead_tup,last_analyze,last_autoanalyze,last_autovacuum FROM pg_stat_user_tables WHERE relname='article_likes')s)) FROM stats_input;
SELECT perf_stats_components_20260927.run('before-vacuum',false);
SELECT perf_stats_components_20260927.run('before-vacuum',true);
-- Changes only the disposable clone's visibility/dead versions; no ANALYZE or app traffic.
VACUUM public.article_likes;
SELECT json_build_object('event','after-vacuum','visibility',(SELECT json_build_object('pages',relpages,'allVisible',relallvisible,'tuples',reltuples) FROM pg_class WHERE oid='public.article_likes'::regclass),'likeStats',(SELECT row_to_json(s) FROM(SELECT n_live_tup,n_dead_tup,last_analyze,last_autoanalyze,last_autovacuum FROM pg_stat_user_tables WHERE relname='article_likes')s));
SELECT perf_stats_components_20260927.run('after-vacuum',false);
SELECT perf_stats_components_20260927.run('after-vacuum',true);
SELECT json_build_object('event','final','cohortRows',(SELECT count(*) FROM stats_input),'wrongCohort',(SELECT count(*) FROM stats_input i JOIN public.article_stats s USING(article_id) WHERE s.view_count<>i.before_views OR s.like_count<>i.before_likes OR s.updated_at<>i.before_updated),'likes',(SELECT count(*) FROM public.article_likes));
DROP SCHEMA perf_stats_components_20260927 CASCADE;
