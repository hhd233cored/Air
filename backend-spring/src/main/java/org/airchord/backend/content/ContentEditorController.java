package org.airchord.backend.content;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/** 编辑器 multipart API；Controller 负责 HTTP 表单绑定，业务规则交由 Service。 */
@RestController
@RequestMapping("/api/v1/editor")
public class ContentEditorController {
    private final ContentEditorService service;
    public ContentEditorController(ContentEditorService service) { this.service = service; }

    @GetMapping("/articles")
    public ArticlePageResponse listArticles(@RequestParam(defaultValue = "0") int page,
                                            @RequestParam(defaultValue = "20") int size,
                                            @RequestParam(required = false) String q) {
        return service.listArticles(page, size, q);
    }

    @GetMapping("/articles/{slug}")
    public ArticleDetail article(@PathVariable String slug) { return service.getArticle(slug); }

    @PostMapping("/articles")
    public ResponseEntity<ArticleDetail> createArticle(
            @RequestParam String title, @RequestParam(required = false) String slug,
            @RequestParam(required = false) String summary, @RequestParam(required = false) String tags,
            @RequestParam(defaultValue = "DRAFT") String status, @RequestParam(required = false) String publishedAt,
            @RequestParam(defaultValue = "") String contentMarkdown, @RequestParam MultipartFile cover,
            @RequestParam(required = false) List<MultipartFile> assets) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(service.createArticle(title, slug, summary, tags, status, publishedAt, contentMarkdown, cover, assets));
    }

    @PutMapping("/articles/{slug}")
    public ArticleDetail updateArticle(
            @PathVariable String slug, @RequestParam String title, @RequestParam(required = false) String newSlug,
            @RequestParam(required = false) String summary, @RequestParam(required = false) String tags,
            @RequestParam(required = false) String status, @RequestParam(required = false) String publishedAt,
            @RequestParam(defaultValue = "") String contentMarkdown, @RequestParam(required = false) MultipartFile cover,
            @RequestParam(required = false) List<MultipartFile> assets) {
        return service.updateArticle(slug, title, newSlug, summary, tags, status, publishedAt,
                contentMarkdown, cover, assets);
    }

    @DeleteMapping("/articles/{slug}")
    public ResponseEntity<Void> deleteArticle(@PathVariable String slug) {
        service.delete("ARTICLE", slug); return ResponseEntity.noContent().build();
    }

    @GetMapping("/chatter")
    public ChatterPageResponse listChatter(@RequestParam(defaultValue = "0") int page,
                                           @RequestParam(defaultValue = "50") int size,
                                           @RequestParam(required = false) String q) {
        return service.listChatter(page, size, q);
    }

    @GetMapping("/chatter/{slug}")
    public ChatterDetail chatter(@PathVariable String slug) { return service.getChatter(slug); }

    @PostMapping("/chatter")
    public ResponseEntity<ChatterDetail> createChatter(
            @RequestParam(required = false) String slug, @RequestParam(defaultValue = "DRAFT") String status,
            @RequestParam(required = false) String publishedAt, @RequestParam(defaultValue = "") String contentMarkdown,
            @RequestParam(required = false) List<MultipartFile> assets) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.createChatter(slug, status, publishedAt, contentMarkdown, assets));
    }

    @PutMapping("/chatter/{slug}")
    public ChatterDetail updateChatter(
            @PathVariable String slug, @RequestParam(required = false) String newSlug,
            @RequestParam(required = false) String status, @RequestParam(required = false) String publishedAt,
            @RequestParam(defaultValue = "") String contentMarkdown, @RequestParam(required = false) List<MultipartFile> assets) {
        return service.updateChatter(slug, newSlug, status, publishedAt, contentMarkdown, assets);
    }

    @DeleteMapping("/chatter/{slug}")
    public ResponseEntity<Void> deleteChatter(@PathVariable String slug) {
        service.delete("CHATTER", slug); return ResponseEntity.noContent().build();
    }
}
