package com.yourspace.article.dto;

import com.yourspace.article.entity.ArticleStatus;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public record ArticleSummaryResponse(
        UUID id,
        String slug,
        String title,
        String summary,
        String coverUrl,
        Set<String> tags,
        ArticleStatus status,
        Instant publishedAt,
        Instant createdAt,
        Instant updatedAt
) {
}
