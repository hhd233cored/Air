-- 这些是完全虚构的本地学习数据，仅在 local/test profile 下执行。
-- 用户密码字段刻意使用无效占位值：demo 用户用于内容评论参照，不能拿来登录。

INSERT INTO users (
    id, username, password_hash, role, enabled, created_at, updated_at
) VALUES
    (1001, 'demo-admin', 'FIXTURE_ONLY_NOT_A_PASSWORD_HASH', 'ADMIN', TRUE,
     TIMESTAMPTZ '2026-09-01 09:00:00+00', TIMESTAMPTZ '2026-09-01 09:00:00+00'),
    (1002, 'demo-reader', 'FIXTURE_ONLY_NOT_A_PASSWORD_HASH', 'USER', TRUE,
     TIMESTAMPTZ '2026-09-01 09:05:00+00', TIMESTAMPTZ '2026-09-01 09:05:00+00');

INSERT INTO content_items (
    id, content_type, slug, title, summary, preview, cover_path, cover_color,
    tags, status, content_markdown, published_at, created_at, updated_at
) VALUES
    ('article-demo', 'ARTICLE', 'learning-spring', '用 Spring 学习后端',
     '一篇用于固定接口字段的虚构文章。', NULL, '/articles/learning-spring/cover.svg', '#315B8A',
     '["学习", "Spring"]'::jsonb, 'PUBLISHED',
     '# 用 Spring 学习后端\n\n这是一份虚构的 Markdown 参照正文。',
     TIMESTAMPTZ '2026-09-01 10:00:00+00', TIMESTAMPTZ '2026-09-01 09:00:00+00', TIMESTAMPTZ '2026-09-01 10:00:00+00'),
    ('article-draft-demo', 'ARTICLE', 'draft-reference', '未发布文章',
     '此文章只用于测试草稿不可公开。', NULL, NULL, NULL,
     '[]'::jsonb, 'DRAFT', '# 未发布文章\n\n这段内容不应出现在公开接口。',
     NULL, TIMESTAMPTZ '2026-09-02 09:00:00+00', TIMESTAMPTZ '2026-09-02 09:00:00+00'),
    ('chatter-demo', 'CHATTER', 'small-note', NULL,
     NULL, '慢一点，事情仍然会发生。', NULL, NULL,
     '[]'::jsonb, 'PUBLISHED', '慢一点，**事情**仍然会发生。',
     TIMESTAMPTZ '2026-09-03 10:00:00+00', TIMESTAMPTZ '2026-09-03 09:00:00+00', TIMESTAMPTZ '2026-09-03 10:00:00+00'),
    ('chatter-draft-demo', 'CHATTER', 'private-note', NULL,
     NULL, '仅用于草稿过滤验证。', NULL, NULL,
     '[]'::jsonb, 'DRAFT', '仅用于草稿过滤验证。',
     NULL, TIMESTAMPTZ '2026-09-04 09:00:00+00', TIMESTAMPTZ '2026-09-04 09:00:00+00');

INSERT INTO comments (
    id, target_type, target_id, user_id, parent_id, content, status, created_at, updated_at
) VALUES
    (2001, 'ARTICLE', 'learning-spring', 1002, NULL, '这篇示例文章很清楚。', 'VISIBLE',
     TIMESTAMPTZ '2026-09-05 09:00:00+00', TIMESTAMPTZ '2026-09-05 09:00:00+00'),
    (2002, 'ARTICLE', 'learning-spring', 1001, 2001, '谢谢，这是虚构的一级回复。', 'VISIBLE',
     TIMESTAMPTZ '2026-09-05 09:10:00+00', TIMESTAMPTZ '2026-09-05 09:10:00+00');

-- 显式插入 identity 主键后，重设序列，避免后续开发插入时撞上样例 ID。
SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT MAX(id) FROM users), TRUE);
SELECT setval(pg_get_serial_sequence('comments', 'id'), (SELECT MAX(id) FROM comments), TRUE);
