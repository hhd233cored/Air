package org.airchord.backend.interaction;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 正文长度上限与 Python 默认 COMMENTS_MAX_LENGTH 保持一致。 */
public record CommentCreateRequest(
        @NotBlank @Size(max = 5000) String content,
        @Min(1) Long parentId
) {
}
