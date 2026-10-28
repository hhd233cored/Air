-- 管理员重置密码或更改账号权限时递增版本号，让仍存活的旧 Redis session 立即失效。
-- Redis 主体索引负责主动删除 session；每请求校验版本则在 Redis 暂时不可用时继续保护。
ALTER TABLE users
    ADD COLUMN security_version BIGINT NOT NULL DEFAULT 0;
