-- 新增虚构留言样例时追加 fixture 版本，不修改已经执行过的 V900。
INSERT INTO guestbook_messages (
    id, user_id, content, status, created_at, updated_at
) VALUES (
    3001, 1002, '这是一条虚构的留言板样例。', 'VISIBLE',
    TIMESTAMPTZ '2026-09-07 09:00:00+00', TIMESTAMPTZ '2026-09-07 09:00:00+00'
);

SELECT setval(pg_get_serial_sequence('guestbook_messages', 'id'),
              (SELECT MAX(id) FROM guestbook_messages), TRUE);
