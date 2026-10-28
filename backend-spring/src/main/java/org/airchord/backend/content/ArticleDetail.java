package org.airchord.backend.content;

import java.util.List;

/** 文章详情在列表字段之外增加完整 Markdown 正文。 */
public record ArticleDetail(
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
        String updatedAt,
        String contentMarkdown
) {
    public static ArticleDetail from(ArticleSummary summary, String contentMarkdown) {
        return new ArticleDetail(
                summary.id(), summary.slug(), summary.title(), summary.summary(),
                summary.coverUrl(), summary.coverColor(), summary.tags(), summary.status(),
                summary.publishedAt(), summary.createdAt(), summary.updatedAt(), contentMarkdown
        );
    }
}
