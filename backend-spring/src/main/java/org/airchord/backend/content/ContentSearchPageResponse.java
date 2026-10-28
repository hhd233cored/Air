package org.airchord.backend.content;

import java.util.List;

/** 搜索分页 DTO 沿用列表接口的 0 起始页码和字段结构。 */
public record ContentSearchPageResponse(
        List<ContentSearchResult> content,
        int page,
        int size,
        long totalElements,
        int totalPages
) {
}
