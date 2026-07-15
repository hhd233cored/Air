package com.yourspace.article.controller;

import com.yourspace.article.dto.ArticleResponse;
import com.yourspace.article.dto.ArticleSummaryResponse;
import com.yourspace.article.dto.CreateArticleRequest;
import com.yourspace.article.dto.UpdateArticleRequest;
import com.yourspace.article.entity.ArticleStatus;
import com.yourspace.article.service.ArticleService;
import com.yourspace.common.PageResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/articles")
@Tag(name = "Articles")
public class ArticleController {
    private final ArticleService service;

    public ArticleController(ArticleService service) {
        this.service = service;
    }

    @GetMapping
    public PageResponse<ArticleSummaryResponse> list(@RequestParam(defaultValue = "PUBLISHED") ArticleStatus status, @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "10") int size, @RequestParam(required = false) String tag) {
        if (page < 0 || size < 1 || size > 50) throw new IllegalArgumentException("page must be >= 0 and size must be between 1 and 50");
        if (status != ArticleStatus.PUBLISHED) throw new IllegalArgumentException("Only PUBLISHED articles are available through the public list");
        return service.listPublished(page, size, tag);
    }

    @GetMapping("/{slug}")
    public ArticleResponse get(@PathVariable String slug) {
        return service.getPublished(slug);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('ADMIN')")
    public ArticleResponse create(@Valid @RequestBody CreateArticleRequest request) {
        return service.create(request);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ArticleResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateArticleRequest request) {
        return service.update(id, request);
    }

    @PostMapping("/{id}/publish")
    @PreAuthorize("hasRole('ADMIN')")
    public ArticleResponse publish(@PathVariable UUID id) {
        return service.publish(id);
    }

    @PostMapping("/{id}/archive")
    @PreAuthorize("hasRole('ADMIN')")
    public ArticleResponse archive(@PathVariable UUID id) {
        return service.archive(id);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasRole('ADMIN')")
    public void delete(@PathVariable UUID id) {
        service.delete(id);
    }
}
