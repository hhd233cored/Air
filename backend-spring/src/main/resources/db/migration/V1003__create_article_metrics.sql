-- 文章点赞关系以 PostgreSQL 为准；主键保证同一用户不会同时拥有两条有效点赞。
CREATE TABLE article_likes (
    article_id VARCHAR(80) NOT NULL REFERENCES content_items (id),
    user_id BIGINT NOT NULL REFERENCES users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (article_id, user_id)
);

-- 一次页面展示使用一个事件 ID；网络重试沿用该 ID，不会重复记浏览。
CREATE TABLE article_view_events (
    id UUID PRIMARY KEY,
    article_id VARCHAR(80) NOT NULL REFERENCES content_items (id),
    user_id BIGINT REFERENCES users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX article_view_events_article_idx ON article_view_events (article_id);

-- 统计是可重建的读模型；点赞可由 article_likes 核对，浏览可由事件表核对。
CREATE TABLE article_stats (
    article_id VARCHAR(80) PRIMARY KEY REFERENCES content_items (id),
    view_count BIGINT NOT NULL DEFAULT 0 CHECK (view_count >= 0),
    like_count BIGINT NOT NULL DEFAULT 0 CHECK (like_count >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 行为事实与待发送事件在同一个事务提交；RabbitMQ 暂停时事件留在这里。
CREATE TABLE article_metric_outbox (
    id UUID PRIMARY KEY,
    article_id VARCHAR(80) NOT NULL REFERENCES content_items (id),
    metric_type VARCHAR(8) NOT NULL CHECK (metric_type IN ('VIEW', 'LIKE')),
    delta SMALLINT NOT NULL CHECK (delta IN (-1, 1)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_until TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)
);
CREATE INDEX article_metric_outbox_pending_idx
    ON article_metric_outbox (next_attempt_at, created_at)
    WHERE published_at IS NULL;

-- Consumer 在更新统计的同一事务登记事件 ID；重投不会再加一次。
CREATE TABLE article_metric_processed (
    event_id UUID PRIMARY KEY REFERENCES article_metric_outbox (id),
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
