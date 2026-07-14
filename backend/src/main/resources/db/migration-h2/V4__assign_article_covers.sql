UPDATE articles
SET cover_url = CASE slug
    WHEN 'first-note' THEN '/article-covers/first-note.svg'
    WHEN 'quiet-corner' THEN '/article-covers/quiet-corner.svg'
    WHEN 'building-a-place-for-notes' THEN '/article-covers/building-a-place-for-notes.svg'
    WHEN 'the-weather-of-a-day' THEN '/article-covers/the-weather-of-a-day.svg'
    WHEN 'small-things-worth-keeping' THEN '/article-covers/small-things-worth-keeping.svg'
    ELSE cover_url
END
WHERE slug IN (
    'first-note',
    'quiet-corner',
    'building-a-place-for-notes',
    'the-weather-of-a-day',
    'small-things-worth-keeping'
);
