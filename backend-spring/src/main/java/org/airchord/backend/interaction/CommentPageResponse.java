package org.airchord.backend.interaction;

import java.util.List;

/** 评论与留言板共用的分页 JSON 外壳。 */
public record CommentPageResponse(
        List<CommentResponse> content,
        int page,
        int size,
        long totalElements,
        int totalPages
) {
}
