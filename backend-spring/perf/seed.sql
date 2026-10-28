-- 仅在独立的 air_perf 数据库运行；固定、虚构的数据让列表、搜索和分页有可测规模。
INSERT INTO content_items
    (id, content_type, slug, title, summary, preview, cover_color, tags, status,
     content_markdown, published_at, created_at, updated_at)
SELECT 'perf-article-' || n, 'ARTICLE', 'perf-article-' || n,
       'Spring 压测文章 ' || n, '虚构的性能测试摘要 ' || n,
       '虚构的性能测试预览 ' || n, '#315B8A', '["Spring","性能"]'::jsonb,
       'PUBLISHED', repeat('Spring JDBC PostgreSQL 性能测试正文。', 20),
       now() - (n || ' minutes')::interval,
       now() - (n || ' minutes')::interval,
       now() - (n || ' minutes')::interval
FROM generate_series(1, 2000) AS n;

INSERT INTO content_items
    (id, content_type, slug, title, preview, tags, status,
     content_markdown, published_at, created_at, updated_at)
SELECT 'perf-chatter-' || n, 'CHATTER', 'perf-chatter-' || n, NULL,
       '虚构的说说预览 ' || n, '[]'::jsonb, 'PUBLISHED',
       repeat('Spring 性能测试说说。', 10),
       now() - (n || ' minutes')::interval,
       now() - (n || ' minutes')::interval,
       now() - (n || ' minutes')::interval
FROM generate_series(1, 2000) AS n;

-- 每篇被选中的文章分配约 100 条评论，用于测试公开分页查询。
INSERT INTO comments (target_type, target_id, user_id, content, status, created_at, updated_at)
SELECT 'ARTICLE', 'perf-article-' || ((n - 1) % 100 + 1), 1002,
       '虚构的压测评论 ' || n, 'VISIBLE',
       now() - (n || ' seconds')::interval,
       now() - (n || ' seconds')::interval
FROM generate_series(1, 10000) AS n;

INSERT INTO guestbook_messages (user_id, content, status, created_at, updated_at)
SELECT 1002, '虚构的压测留言 ' || n, 'VISIBLE',
       now() - (n || ' seconds')::interval,
       now() - (n || ' seconds')::interval
FROM generate_series(1, 1000) AS n;

ANALYZE content_items;
ANALYZE comments;
ANALYZE guestbook_messages;
