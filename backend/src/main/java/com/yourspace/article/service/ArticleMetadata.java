package com.yourspace.article.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.yourspace.article.entity.ArticleStatus;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@JsonIgnoreProperties(ignoreUnknown = true)
public record ArticleMetadata(
        UUID id,
        String slug,
        String title,
        String summary,
        List<String> tags,
        ArticleStatus status,
        Instant publishedAt,
        Instant createdAt,
        Instant updatedAt,
        String cover
) {
}
