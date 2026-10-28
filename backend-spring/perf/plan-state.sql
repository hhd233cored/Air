SET auto_explain.log_min_duration=-1;
SELECT json_build_object('atEpochMs',floor(extract(epoch FROM clock_timestamp())*1000),
 'stats',(SELECT row_to_json(s) FROM (SELECT n_live_tup,n_dead_tup,n_mod_since_analyze,
 n_ins_since_vacuum,last_analyze,last_autoanalyze,last_vacuum,last_autovacuum,
 analyze_count,autoanalyze_count,vacuum_count,autovacuum_count
 FROM pg_stat_user_tables WHERE relname='article_metric_outbox')s),
 'relation',(SELECT row_to_json(s) FROM (SELECT reltuples,relpages,
 pg_relation_size(oid) table_bytes,pg_total_relation_size(oid) total_bytes
 FROM pg_class WHERE oid='article_metric_outbox'::regclass)s),
 'publishedNullFrac',(SELECT null_frac FROM pg_stats WHERE tablename='article_metric_outbox' AND attname='published_at'),
 'indexes',(SELECT json_agg(row_to_json(s)) FROM (SELECT indexrelname,idx_scan,idx_tup_read,idx_tup_fetch
 FROM pg_stat_user_indexes WHERE relname='article_metric_outbox')s));
