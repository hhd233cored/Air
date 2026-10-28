package org.airchord.backend.content;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 当前阶段开放文章、说说和搜索的公开读取接口，不包含写入或管理能力。 */
@RestController
@RequestMapping("/api/v1")
public class PublicContentController {

    private final ContentReadService service;

    public PublicContentController(ContentReadService service) {
        this.service = service;
    }

    @GetMapping("/articles")
    public ArticlePageResponse articles(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size,
            @RequestParam(required = false) String tag,
            @RequestParam(required = false) String q
    ) {
        return service.listArticles(page, size, tag, q);
    }

    @GetMapping("/articles/{slug}")
    public ArticleDetail article(@PathVariable String slug) {
        return service.article(slug);
    }

    @GetMapping("/chatter")
    public ChatterPageResponse chatter(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size,
            @RequestParam(required = false) String q
    ) {
        return service.listChatter(page, size, q);
    }

    @GetMapping("/chatter/{slug}")
    public ChatterDetail chatter(@PathVariable String slug) {
        return service.chatter(slug);
    }

    @GetMapping("/search")
    public ContentSearchPageResponse search(
            @RequestParam String q,
            @RequestParam(defaultValue = "ALL") String type,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size
    ) {
        return service.search(q, type, page, size);
    }
}
