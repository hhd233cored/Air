package org.airchord.backend.content;

import java.util.List;

/** 与前端分页 DTO 一致，页码从 0 开始。 */
public record ChatterPageResponse(
        List<ChatterSummary> content,
        int page,
        int size,
        long totalElements,
        int totalPages
) {
}
