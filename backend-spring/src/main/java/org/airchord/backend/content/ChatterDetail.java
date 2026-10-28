package org.airchord.backend.content;

/** 说说详情在列表字段之外增加完整 Markdown 正文。 */
public record ChatterDetail(
        String id,
        String slug,
        String preview,
        String status,
        String publishedAt,
        String createdAt,
        String updatedAt,
        String contentMarkdown
) {
    public static ChatterDetail from(ChatterSummary summary, String contentMarkdown) {
        return new ChatterDetail(
                summary.id(), summary.slug(), summary.preview(), summary.status(),
                summary.publishedAt(), summary.createdAt(), summary.updatedAt(), contentMarkdown
        );
    }
}
