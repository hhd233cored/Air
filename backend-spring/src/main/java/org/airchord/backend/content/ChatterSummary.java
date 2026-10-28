package org.airchord.backend.content;

/** 说说列表 DTO；Python 接口不返回 coverUrl，因此这里也不增加该字段。 */
public record ChatterSummary(
        String id,
        String slug,
        String preview,
        String status,
        String publishedAt,
        String createdAt,
        String updatedAt
) {
}
