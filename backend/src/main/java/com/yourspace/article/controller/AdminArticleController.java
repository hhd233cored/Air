package com.yourspace.article.controller;

import com.yourspace.article.dto.ArticleResponse;
import com.yourspace.article.dto.ArticleSummaryResponse;
import com.yourspace.article.entity.ArticleStatus;
import com.yourspace.article.service.ArticleService;
import com.yourspace.common.PageResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/admin/articles")
@Tag(name = "Admin articles")
@PreAuthorize("hasRole('ADMIN')")
public class AdminArticleController {
    private final ArticleService service;

    public AdminArticleController(ArticleService service) {
        this.service = service;
    }

    @GetMapping
    public PageResponse<ArticleSummaryResponse> list(
            @RequestParam(required = false) ArticleStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size
    ) {
        if (page < 0 || size < 1 || size > 50) {
            throw new IllegalArgumentException("page must be >= 0 and size must be between 1 and 50");
        }
        return service.listAdmin(page, size, status);
    }

    @GetMapping("/{id}")
    public ArticleResponse get(@PathVariable UUID id) {
        return service.getAdmin(id);
    }
}
