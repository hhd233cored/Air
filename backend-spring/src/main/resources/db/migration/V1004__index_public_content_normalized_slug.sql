-- 保留公开详情和文章指标现有的不区分大小写、忽略两端空格语义。
-- 公开内容按 slug 访问频繁；只给已发布且未删除的行建立较小的表达式索引。
CREATE INDEX content_items_public_normalized_slug_idx
    ON content_items (content_type, (lower(trim(slug))))
    WHERE status = 'PUBLISHED' AND deleted_at IS NULL;
