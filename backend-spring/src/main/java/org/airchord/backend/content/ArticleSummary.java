package org.airchord.backend.content;

import java.util.List;

/** 文章列表 DTO：字段名与现有前端 ArticleSummary 保持一致。 */
public record ArticleSummary(
        String id,
        String slug,
        String title,
        String summary,
        String coverUrl,
        String coverColor,
        List<String> tags,
        String status,
        String publishedAt,
        String createdAt,
        String updatedAt
) {
}
