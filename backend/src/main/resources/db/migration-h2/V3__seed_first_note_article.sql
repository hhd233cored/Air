MERGE INTO articles KEY(slug) VALUES (
    '55555555-5555-5555-5555-555555555555',
    'first-note',
    'First note',
    'The first sample article served by the Java API.',
    NULL,
    $$# First note

This is the article-page sample. It is loaded from H2 through the Java API before the frontend falls back to `public/articles/first-note.md`.

## A gentle beginning

The site can now keep article metadata in the database while leaving Markdown rendering to the frontend.

> Start small, leave room to grow.$$,
    'PUBLISHED',
    TIMESTAMP WITH TIME ZONE '2026-07-14 12:00:00+00',
    TIMESTAMP WITH TIME ZONE '2026-07-14 12:00:00+00',
    TIMESTAMP WITH TIME ZONE '2026-07-14 12:00:00+00'
);

MERGE INTO article_tags KEY(article_id, tag)
VALUES ('55555555-5555-5555-5555-555555555555', 'notes');
