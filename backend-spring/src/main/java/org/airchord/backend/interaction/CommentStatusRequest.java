package org.airchord.backend.interaction;

import jakarta.validation.constraints.Pattern;

public record CommentStatusRequest(
        @Pattern(regexp = "VISIBLE|HIDDEN|DELETED") String status
) {
}
