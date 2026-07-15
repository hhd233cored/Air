INSERT INTO articles (
    id,
    slug,
    title,
    summary,
    cover_url,
    content_markdown,
    status,
    published_at,
    created_at,
    updated_at
) VALUES (
    '55555555-5555-5555-5555-555555555555',
    'first-note',
    'First note',
    'The first sample article served by the Java API.',
    NULL,
    $$# First note

This is the article-page sample. It is loaded from PostgreSQL through the Java API before the frontend falls back to `public/articles/first-note.md`.

## A gentle beginning

The site can now keep article metadata in the database while leaving Markdown rendering to the frontend.

> Start small, leave room to grow.$$,
    'PUBLISHED',
    TIMESTAMPTZ '2026-07-14 12:00:00+00',
    TIMESTAMPTZ '2026-07-14 12:00:00+00',
    TIMESTAMPTZ '2026-07-14 12:00:00+00'
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO article_tags (article_id, tag)
SELECT id, 'notes'
FROM articles
WHERE slug = 'first-note'
ON CONFLICT (article_id, tag) DO NOTHING;
