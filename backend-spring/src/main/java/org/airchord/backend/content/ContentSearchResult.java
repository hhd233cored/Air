package org.airchord.backend.content;

import java.util.List;

/** 搜索结果 DTO，与 Python ContentSearchResult 的字段名和空值保持一致。 */
public record ContentSearchResult(
        String contentType,
        String id,
        String slug,
        String title,
        String preview,
        String summary,
        String coverUrl,
        List<String> tags,
        String status,
        String publishedAt,
        String createdAt,
        String updatedAt,
        String coverColor
) {
}
