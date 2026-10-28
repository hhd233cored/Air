package org.airchord.backend.interaction;

/** 与现有 comments.ts 的 CommentItem 字段保持一致。 */
public record CommentResponse(
        long id,
        String targetType,
        String targetId,
        Long parentId,
        String content,
        String status,
        CommentAuthor author,
        String createdAt,
        String updatedAt
) {
}
