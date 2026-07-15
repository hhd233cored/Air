MERGE INTO articles KEY(slug) VALUES
(
    '11111111-1111-1111-1111-111111111111',
    'quiet-corner',
    'Notes from a quiet corner',
    'A small collection of thoughts, references, and unfinished ideas.',
    NULL,
    $$# Notes from a quiet corner

This is a sample article stored as Markdown and loaded from the Java API.

> A small space can still hold significant things.

## What stayed

- A sentence worth returning to
- A link saved for later
- A sketch that may become a project

The article page keeps the original Markdown so the frontend can decide how it should be rendered.$$,
    'PUBLISHED',
    TIMESTAMP WITH TIME ZONE '2026-07-13 12:00:00+00',
    TIMESTAMP WITH TIME ZONE '2026-07-13 12:00:00+00',
    TIMESTAMP WITH TIME ZONE '2026-07-13 12:00:00+00'
),
(
    '22222222-2222-2222-2222-222222222222',
    'building-a-place-for-notes',
    'Building a place for notes',
    'Why a personal website should feel more like a room than a feed.',
    NULL,
    $$# Building a place for notes

I wanted this site to feel calm enough for ideas to remain unfinished.

## A slower interface

The homepage is made of small cards, quiet spacing, and a few useful tools. The goal is not to show everything at once, but to leave room for the next thought.

```text
write -> keep -> revisit -> make
```

This sample also verifies that headings, paragraphs, and code blocks render correctly.$$,
    'PUBLISHED',
    TIMESTAMP WITH TIME ZONE '2026-07-12 12:00:00+00',
    TIMESTAMP WITH TIME ZONE '2026-07-12 12:00:00+00',
    TIMESTAMP WITH TIME ZONE '2026-07-12 12:00:00+00'
),
(
    '33333333-3333-3333-3333-333333333333',
    'the-weather-of-a-day',
    'The weather of a day',
    'A short record of light, rain, and the small changes between them.',
    NULL,
    $$# The weather of a day

Some days are best remembered through their atmosphere rather than their events.

The morning was pale and quiet. By afternoon, the clouds opened just enough to let the room turn gold.

## A small observation

> Weather is also a kind of calendar.

When the day ends, the details that remain are often the ones that were never planned.$$,
    'PUBLISHED',
    TIMESTAMP WITH TIME ZONE '2026-07-10 12:00:00+00',
    TIMESTAMP WITH TIME ZONE '2026-07-10 12:00:00+00',
    TIMESTAMP WITH TIME ZONE '2026-07-10 12:00:00+00'
),
(
    '44444444-4444-4444-4444-444444444444',
    'small-things-worth-keeping',
    'Small things worth keeping',
    'A list of little references collected over one ordinary week.',
    NULL,
    $$# Small things worth keeping

Here are a few things that made an ordinary week feel less ordinary:

1. A well-made cup of tea
2. A note written before the idea disappeared
3. A song that changed the pace of a walk

Nothing here is urgent. That is part of why it is worth keeping.$$,
    'PUBLISHED',
    TIMESTAMP WITH TIME ZONE '2026-07-08 12:00:00+00',
    TIMESTAMP WITH TIME ZONE '2026-07-08 12:00:00+00',
    TIMESTAMP WITH TIME ZONE '2026-07-08 12:00:00+00'
);

MERGE INTO article_tags KEY(article_id, tag) VALUES
    ('11111111-1111-1111-1111-111111111111', 'notes'),
    ('11111111-1111-1111-1111-111111111111', 'personal'),
    ('22222222-2222-2222-2222-222222222222', 'design'),
    ('22222222-2222-2222-2222-222222222222', 'notes'),
    ('33333333-3333-3333-3333-333333333333', 'diary'),
    ('33333333-3333-3333-3333-333333333333', 'observations'),
    ('44444444-4444-4444-4444-444444444444', 'links'),
    ('44444444-4444-4444-4444-444444444444', 'personal');
