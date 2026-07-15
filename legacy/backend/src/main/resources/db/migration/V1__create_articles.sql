CREATE TABLE articles (
    id UUID PRIMARY KEY,
    slug VARCHAR(160) NOT NULL UNIQUE,
    title VARCHAR(200) NOT NULL,
    summary VARCHAR(500),
    cover_url VARCHAR(1000),
    content_markdown TEXT NOT NULL,
    status VARCHAR(20) NOT NULL,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_articles_status_published_at ON articles (status, published_at DESC);

CREATE TABLE article_tags (
    article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    tag VARCHAR(50) NOT NULL,
    PRIMARY KEY (article_id, tag)
);

CREATE INDEX idx_article_tags_tag ON article_tags (tag);
