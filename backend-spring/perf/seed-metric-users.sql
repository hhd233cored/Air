-- 只供独立 air-perf 数据库使用。复制压测引导账号的哈希，避免把明文密码写进 SQL。
-- 5000 个账号拥有不同数据库 ID，使点赞唯一键能验证真实的用户级幂等性。
INSERT INTO users (username, password_hash, role, enabled, created_at, updated_at)
SELECT 'metric-user-' || n, source.password_hash, 'USER', TRUE, now(), now()
FROM users AS source CROSS JOIN generate_series(1, 5000) AS n
WHERE source.username = 'perf_user'
ON CONFLICT DO NOTHING;
