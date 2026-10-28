-- 音频上传先落入私有暂存目录；数据库保存任务状态和稳定的 track id。
-- V1001 排在本地 V900/V901 夹具与 Java V1000 迁移之后，兼容已有学习库。
CREATE TABLE music_import_jobs (
    id UUID PRIMARY KEY,
    track_id VARCHAR(64) NOT NULL UNIQUE,
    actor_user_id BIGINT NOT NULL REFERENCES users (id),
    original_filename TEXT NOT NULL,
    staged_bytes BIGINT NOT NULL CHECK (staged_bytes > 0),
    status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    error_code VARCHAR(80),
    lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX music_import_jobs_active_idx
    ON music_import_jobs (status, created_at)
    WHERE status IN ('PENDING', 'RUNNING');

-- 与任务同一 PostgreSQL 事务写入。发送失败后重试，避免任务已接受却没有消息。
CREATE TABLE music_import_outbox (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES music_import_jobs (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_until TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)
);

CREATE INDEX music_import_outbox_pending_idx
    ON music_import_outbox (next_attempt_at, created_at)
    WHERE published_at IS NULL;
