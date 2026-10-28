-- 登录阶段将注册开关保存在 PostgreSQL；Redis 只保存短期会话状态。
-- 初始值由应用启动时按 AUTH_REGISTRATION_ENABLED 写入，之后不会被环境变量覆盖。
CREATE TABLE auth_settings (
    key VARCHAR(80) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
