-- 阶段 2：为已发布内容搜索准备 PostgreSQL 全文索引。
-- generated column 会随正文、标题或标签更新自动重算；无需额外触发器维护。
-- simple 配置不做英文词干扩展，中文和标点子串由仓储中的字面匹配分支兜底。
ALTER TABLE content_items
    ADD COLUMN search_document TSVECTOR
    GENERATED ALWAYS AS (
        to_tsvector(
            'simple',
            coalesce(id, '') || ' ' ||
            coalesce(content_type, '') || ' ' ||
            coalesce(slug, '') || ' ' ||
            coalesce(title, '') || ' ' ||
            coalesce(summary, '') || ' ' ||
            coalesce(tags::text, '') || ' ' ||
            coalesce(content_markdown, '')
        )
    ) STORED;

-- GIN 是 PostgreSQL 文本搜索的常用倒排索引；公开状态仍在 SQL WHERE 中过滤。
CREATE INDEX content_items_search_document_gin_idx
    ON content_items USING GIN (search_document);
