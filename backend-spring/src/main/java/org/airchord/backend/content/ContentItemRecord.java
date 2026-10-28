package org.airchord.backend.content;

import java.util.List;

/**
 * JDBC 读取 content_items 后得到的持久层投影。
 *
 * 这不是 JPA Entity：它只承载查询结果，不负责 API 字段命名、媒体 URL 或业务规则。
 */
public record ContentItemRecord(
        String contentType,
        String id,
        String slug,
        String title,
        String summary,
        String coverPath,
        String coverColor,
        List<String> tags,
        String status,
        String publishedAt,
        String createdAt,
        String updatedAt,
        String contentMarkdown,
        String preview
) {
    /** 写入路径继续由仓储保存生成的预览；读取投影显式携带 preview。 */
    public ContentItemRecord(String contentType, String id, String slug, String title, String summary,
                             String coverPath, String coverColor, List<String> tags, String status,
                             String publishedAt, String createdAt, String updatedAt, String contentMarkdown) {
        this(contentType, id, slug, title, summary, coverPath, coverColor, tags, status,
                publishedAt, createdAt, updatedAt, contentMarkdown, null);
    }
}
