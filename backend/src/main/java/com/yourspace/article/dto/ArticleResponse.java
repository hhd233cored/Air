package com.yourspace.article.dto;

import com.yourspace.article.entity.ArticleStatus;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public record ArticleResponse(
        UUID id,
        String slug,
        String title,
        String summary,
        String coverUrl,
        String contentMarkdown,
        Set<String> tags,
        ArticleStatus status,
        Instant publishedAt,
        Instant updatedAt
) {
}
