package com.yourspace.article.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.yourspace.article.dto.ArticleResponse;
import com.yourspace.article.dto.ArticleSummaryResponse;
import com.yourspace.article.entity.ArticleStatus;
import com.yourspace.common.PageResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Service
public class ArticleService {
    private static final Logger log = LoggerFactory.getLogger(ArticleService.class);
    private static final String METADATA_FILE = "article.json";
    private static final String CONTENT_FILE = "article.md";

    private final ObjectMapper objectMapper;
    private final Path articlesRoot;

    public ArticleService(ObjectMapper objectMapper, @Value("${app.articles.directory:./public/articles}") String articlesDirectory) {
        this.objectMapper = objectMapper;
        this.articlesRoot = Paths.get(articlesDirectory).toAbsolutePath().normalize();
    }

    public PageResponse<ArticleSummaryResponse> listPublished(int page, int size, String tag) {
        String normalizedTag = normalizeTag(tag);
        List<ArticleMetadata> articles = readMetadata().stream()
                .filter(article -> article.status() == ArticleStatus.PUBLISHED)
                .filter(article -> normalizedTag == null || article.tags() != null && article.tags().stream().map(this::normalizeTag).anyMatch(normalizedTag::equals))
                .sorted(Comparator.comparing(ArticleMetadata::publishedAt, Comparator.nullsLast(Comparator.reverseOrder()))
                        .thenComparing(ArticleMetadata::createdAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .toList();

        int from = Math.min(page * size, articles.size());
        int to = Math.min(from + size, articles.size());
        int totalPages = articles.isEmpty() ? 0 : (int) Math.ceil(articles.size() / (double) size);
        List<ArticleSummaryResponse> content = articles.subList(from, to).stream()
                .map(this::toSummary)
                .toList();
        return new PageResponse<>(content, page, size, articles.size(), totalPages);
    }

    public ArticleResponse getPublished(String slug) {
        ArticleMetadata metadata = readMetadata().stream()
                .filter(article -> article.status() == ArticleStatus.PUBLISHED)
                .filter(article -> normalizeSlug(article.slug()).equals(normalizeSlug(slug)))
                .findFirst()
                .orElseThrow(() -> new ArticleNotFoundException(slug));

        Path folder = folderFor(metadata);
        Path contentPath = folder.resolve(CONTENT_FILE).normalize();
        if (!contentPath.startsWith(folder) || !Files.isRegularFile(contentPath)) {
            throw new ArticleNotFoundException(slug);
        }
        try {
            String markdown = Files.readString(contentPath, StandardCharsets.UTF_8);
            return new ArticleResponse(metadata.id(), metadata.slug(), metadata.title(), metadata.summary(), coverUrl(metadata, folder), markdown, tags(metadata), metadata.status(), metadata.publishedAt(), metadata.createdAt(), metadata.updatedAt());
        } catch (IOException exception) {
            log.warn("Could not read article content for {}", slug, exception);
            throw new ArticleNotFoundException(slug);
        }
    }

    private List<ArticleMetadata> readMetadata() {
        if (!Files.isDirectory(articlesRoot)) return List.of();
        List<ArticleMetadata> result = new ArrayList<>();
        try (Stream<Path> folders = Files.list(articlesRoot)) {
            folders.filter(Files::isDirectory).forEach(folder -> {
                Path metadataPath = folder.resolve(METADATA_FILE);
                if (!Files.isRegularFile(metadataPath)) return;
                try {
                    ArticleMetadata metadata = objectMapper.readValue(metadataPath.toFile(), ArticleMetadata.class);
                    if (metadata.slug() == null || !normalizeSlug(metadata.slug()).equals(normalizeSlug(folder.getFileName().toString()))) {
                        log.warn("Skipping article with mismatched folder and slug: {}", metadataPath);
                        return;
                    }
                    result.add(metadata);
                } catch (IOException | RuntimeException exception) {
                    log.warn("Skipping invalid article metadata: {}", metadataPath, exception);
                }
            });
        } catch (IOException exception) {
            log.warn("Could not scan article directory {}", articlesRoot, exception);
        }
        return result;
    }

    private ArticleSummaryResponse toSummary(ArticleMetadata metadata) {
        return new ArticleSummaryResponse(metadata.id(), metadata.slug(), metadata.title(), metadata.summary(), coverUrl(metadata, folderFor(metadata)), tags(metadata), metadata.status(), metadata.publishedAt(), metadata.createdAt(), metadata.updatedAt());
    }

    private Path folderFor(ArticleMetadata metadata) {
        return articlesRoot.resolve(normalizeSlug(metadata.slug())).normalize();
    }

    private String coverUrl(ArticleMetadata metadata, Path folder) {
        if (metadata.cover() == null || metadata.cover().isBlank()) return null;
        Path coverPath = folder.resolve(metadata.cover()).normalize();
        if (!coverPath.startsWith(folder) || !Files.isRegularFile(coverPath)) return null;
        return "/articles/" + normalizeSlug(metadata.slug()) + "/" + metadata.cover().replace('\\', '/');
    }

    private Set<String> tags(ArticleMetadata metadata) {
        if (metadata.tags() == null) return Set.of();
        return metadata.tags().stream().filter(tag -> tag != null && !tag.isBlank()).map(this::normalizeTag).collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private String normalizeSlug(String slug) {
        return slug == null ? "" : slug.trim().toLowerCase(Locale.ROOT);
    }

    private String normalizeTag(String tag) {
        return tag == null || tag.isBlank() ? null : tag.trim().toLowerCase(Locale.ROOT);
    }
}
