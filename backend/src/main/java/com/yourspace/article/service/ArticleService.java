package com.yourspace.article.service;

import com.yourspace.article.dto.ArticleResponse;
import com.yourspace.article.dto.ArticleSummaryResponse;
import com.yourspace.article.dto.CreateArticleRequest;
import com.yourspace.article.dto.UpdateArticleRequest;
import com.yourspace.article.entity.Article;
import com.yourspace.article.entity.ArticleStatus;
import com.yourspace.article.repository.ArticleRepository;
import com.yourspace.common.PageResponse;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
@Transactional
public class ArticleService {
    private final ArticleRepository repository;

    public ArticleService(ArticleRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public PageResponse<ArticleSummaryResponse> listPublished(int page, int size, String tag) {
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "publishedAt"));
        Page<Article> result = tag == null || tag.isBlank()
                ? repository.findAllByStatus(ArticleStatus.PUBLISHED, pageable)
                : repository.findAllByStatusAndTag(ArticleStatus.PUBLISHED, normalizeTag(tag), pageable);
        return new PageResponse<>(result.map(this::toSummary).getContent(), result.getNumber(), result.getSize(), result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    public ArticleResponse getPublished(String slug) {
        return repository.findBySlugAndStatus(normalizeSlug(slug), ArticleStatus.PUBLISHED)
                .map(this::toResponse)
                .orElseThrow(() -> new ArticleNotFoundException(slug));
    }

    public ArticleResponse create(CreateArticleRequest request) {
        String slug = request.slug() == null || request.slug().isBlank() ? slugify(request.title()) : normalizeSlug(request.slug());
        ensureSlugAvailable(slug, null);
        Article article = new Article(slug, request.title().trim(), clean(request.summary()), clean(request.coverUrl()), request.contentMarkdown(), normalizeTags(request.tags()));
        return toResponse(repository.save(article));
    }

    public ArticleResponse update(UUID id, UpdateArticleRequest request) {
        Article article = getById(id);
        String slug = request.slug() == null || request.slug().isBlank() ? slugify(request.title()) : normalizeSlug(request.slug());
        ensureSlugAvailable(slug, id);
        article.setSlug(slug);
        article.setTitle(request.title().trim());
        article.setSummary(clean(request.summary()));
        article.setCoverUrl(clean(request.coverUrl()));
        article.setContentMarkdown(request.contentMarkdown());
        article.setTags(normalizeTags(request.tags()));
        return toResponse(repository.save(article));
    }

    public ArticleResponse publish(UUID id) {
        Article article = getById(id);
        article.setStatus(ArticleStatus.PUBLISHED);
        article.setPublishedAt(article.getPublishedAt() == null ? Instant.now() : article.getPublishedAt());
        return toResponse(repository.save(article));
    }

    public ArticleResponse archive(UUID id) {
        Article article = getById(id);
        article.setStatus(ArticleStatus.ARCHIVED);
        return toResponse(repository.save(article));
    }

    public void delete(UUID id) {
        Article article = getById(id);
        repository.delete(article);
    }

    private Article getById(UUID id) {
        return repository.findById(id).orElseThrow(() -> new ArticleNotFoundException(id));
    }

    private void ensureSlugAvailable(String slug, UUID id) {
        boolean exists = id == null ? repository.existsBySlug(slug) : repository.existsBySlugAndIdNot(slug, id);
        if (exists) throw new DuplicateSlugException(slug);
    }

    private ArticleSummaryResponse toSummary(Article article) {
        return new ArticleSummaryResponse(article.getId(), article.getSlug(), article.getTitle(), article.getSummary(), article.getCoverUrl(), Set.copyOf(article.getTags()), article.getStatus(), article.getPublishedAt(), article.getUpdatedAt());
    }

    private ArticleResponse toResponse(Article article) {
        return new ArticleResponse(article.getId(), article.getSlug(), article.getTitle(), article.getSummary(), article.getCoverUrl(), article.getContentMarkdown(), Set.copyOf(article.getTags()), article.getStatus(), article.getPublishedAt(), article.getUpdatedAt());
    }

    private static String clean(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static Set<String> normalizeTags(Set<String> tags) {
        Set<String> normalized = new LinkedHashSet<>();
        if (tags != null) {
            tags.stream().filter(tag -> tag != null && !tag.isBlank()).map(ArticleService::normalizeTag).forEach(normalized::add);
        }
        return normalized;
    }

    private static String normalizeTag(String tag) {
        return tag.trim().toLowerCase(Locale.ROOT);
    }

    private static String normalizeSlug(String slug) {
        return slug.trim().toLowerCase(Locale.ROOT);
    }

    private static String slugify(String title) {
        String slug = title.toLowerCase(Locale.ROOT).trim().replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
        return slug.isBlank() ? "article-" + UUID.randomUUID().toString().substring(0, 8) : slug;
    }
}
