package com.yourspace.article.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ArticleServiceTest {
    @TempDir
    Path articlesRoot;

    @Test
    void listsPublishedArticlesByPublishedDateAndReadsMarkdown() throws Exception {
        writeArticle("older", "Older", "2026-07-10T12:00:00Z", "# Older\n\nOlder body", "cover.svg");
        writeArticle("newer", "Newer", "2026-07-14T12:00:00Z", "# Newer\n\nNewer body", null);
        writeArticle("draft", "Draft", "2026-07-15T12:00:00Z", "# Draft", null, "DRAFT");

        ArticleService service = new ArticleService(new ObjectMapper().findAndRegisterModules(), articlesRoot.toString());

        var page = service.listPublished(0, 10, null);
        assertEquals(2, page.totalElements());
        assertEquals("newer", page.content().get(0).slug());
        assertEquals("/articles/older/cover.svg", page.content().get(1).coverUrl());
        assertEquals("# Newer\n\nNewer body", service.getPublished("newer").contentMarkdown());
    }

    @Test
    void filtersPublishedArticlesByTagAndRejectsUnknownSlug() throws Exception {
        writeArticle("design-note", "Design note", "2026-07-14T12:00:00Z", "# Design", null, "PUBLISHED", "Design");
        writeArticle("daily-note", "Daily note", "2026-07-13T12:00:00Z", "# Daily", null, "PUBLISHED", "diary");

        ArticleService service = new ArticleService(new ObjectMapper().findAndRegisterModules(), articlesRoot.toString());

        assertEquals(1, service.listPublished(0, 10, "design").totalElements());
        assertThrows(ArticleNotFoundException.class, () -> service.getPublished("missing"));
    }

    private void writeArticle(String slug, String title, String publishedAt, String markdown, String cover) throws Exception {
        writeArticle(slug, title, publishedAt, markdown, cover, "PUBLISHED", "notes");
    }

    private void writeArticle(String slug, String title, String publishedAt, String markdown, String cover, String status, String... tags) throws Exception {
        Path folder = Files.createDirectories(articlesRoot.resolve(slug));
        String coverJson = cover == null ? "null" : "\"" + cover + "\"";
        String metadata = """
                {
                  "id": "00000000-0000-0000-0000-%012d",
                  "slug": "%s",
                  "title": "%s",
                  "summary": "%s",
                  "tags": ["%s"],
                  "status": "%s",
                  "publishedAt": "%s",
                  "createdAt": "%s",
                  "updatedAt": "%s",
                  "cover": %s
                }
                """.formatted(Math.abs(slug.hashCode()), slug, title, title, String.join("\",\"", tags), status, publishedAt, publishedAt, publishedAt, coverJson);
        Files.writeString(folder.resolve("article.json"), metadata, StandardCharsets.UTF_8);
        Files.writeString(folder.resolve("article.md"), markdown, StandardCharsets.UTF_8);
        if (cover != null) Files.writeString(folder.resolve(cover), "cover", StandardCharsets.UTF_8);
    }
}
