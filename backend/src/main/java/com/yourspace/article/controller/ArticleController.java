package com.yourspace.article.controller;

import com.yourspace.article.dto.ArticleResponse;
import com.yourspace.article.dto.ArticleSummaryResponse;
import com.yourspace.article.service.ArticleService;
import com.yourspace.common.PageResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/articles")
public class ArticleController {
    private final ArticleService service;

    public ArticleController(ArticleService service) {
        this.service = service;
    }

    @GetMapping
    public PageResponse<ArticleSummaryResponse> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size,
            @RequestParam(required = false) String tag
    ) {
        if (page < 0 || size < 1 || size > 50) {
            throw new IllegalArgumentException("page must be >= 0 and size must be between 1 and 50");
        }
        return service.listPublished(page, size, tag);
    }

    @GetMapping("/{slug}")
    public ArticleResponse get(@PathVariable String slug) {
        return service.getPublished(slug);
    }
}
