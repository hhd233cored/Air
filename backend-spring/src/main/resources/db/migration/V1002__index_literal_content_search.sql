-- 原搜索的字面分支每次都拼接字段并逐行 POSITION；保存同一份小写文本供 trigram 索引检索。
-- pg_trgm 是 PostgreSQL 自带的 trusted 扩展；明确装在 public，供独立测试 schema 共用操作类。
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

ALTER TABLE content_items ADD COLUMN search_literal_lc TEXT;

-- 字段顺序、换行分隔符与旧 SQL 的 concat_ws 完全一致，避免迁移后改变匹配结果。
CREATE FUNCTION content_items_refresh_search_literal_lc()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.search_literal_lc := lower(concat_ws(E'\n', NEW.id, NEW.slug, NEW.content_type,
        NEW.title, NEW.summary, NEW.tags::text, NEW.content_markdown));
    RETURN NEW;
END;
$$;

-- 数据库统一维护派生列；编辑器、测试夹具或其他 JDBC 写入都不必手工同步搜索文本。
CREATE TRIGGER content_items_search_literal_lc_write
BEFORE INSERT OR UPDATE ON content_items
FOR EACH ROW EXECUTE FUNCTION content_items_refresh_search_literal_lc();

UPDATE content_items
SET search_literal_lc = lower(concat_ws(E'\n', id, slug, content_type,
    title, summary, tags::text, content_markdown));

ALTER TABLE content_items ALTER COLUMN search_literal_lc SET NOT NULL;

-- 公开搜索始终排除草稿、归档和软删除记录，部分索引只保存会被公开查询的行。
CREATE INDEX content_items_public_literal_trgm_idx
    ON content_items USING GIN (search_literal_lc public.gin_trgm_ops)
    WHERE status = 'PUBLISHED' AND deleted_at IS NULL;
