package com.yourspace.article.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.Set;

public record CreateArticleRequest(
        @Size(max = 160) String slug,
        @NotBlank @Size(max = 200) String title,
        @Size(max = 500) String summary,
        @Size(max = 1000) String coverUrl,
        @NotBlank String contentMarkdown,
        Set<@Size(max = 50) String> tags
) {
}
