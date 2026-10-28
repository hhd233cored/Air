package org.airchord.backend.content;

import org.airchord.backend.content.ContentReadRepository.PageRows;
import org.airchord.backend.web.ApiBadRequestException;
import org.airchord.backend.web.ContentNotFoundException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;

/** 把数据库记录转换为公开 DTO，并在返回封面链接前确认资源真实存在。 */
@Service
public class ContentReadService {

    private static final int MAX_PAGE_SIZE = 50;
    private static final int MAX_QUERY_LENGTH = 100;

    private final ContentReadRepository repository;
    private final PublicContentCache cache;
    private final Path articleRoot;

    public ContentReadService(
            ContentReadRepository repository,
            PublicContentCache cache,
            @Value("${airchord.media.articles-dir:../public/articles}") String articleRoot
    ) {
        this.repository = repository;
        this.cache = cache;
        this.articleRoot = Path.of(articleRoot).toAbsolutePath().normalize();
    }


    public ArticlePageResponse listArticles(int page, int size, String tag, String query) {
        validatePage(page, size, query);
        String normalizedTag = normalizeOptional(tag);
        String normalizedQuery = normalizeOptional(query);
        PageRows<ContentItemRecord> result = repository.listArticles(page, size, normalizedTag, normalizedQuery);
        // 仓储只返回数据库投影；此处再转换 API DTO，并确认封面文件真实存在。
        List<ArticleSummary> visible = result.rows().stream()
                .map(this::toArticleSummary)
                .toList();
        return new ArticlePageResponse(visible, page, size, result.totalElements(), totalPages(size, result.totalElements()));
    }

    public ArticleDetail article(String slug) {
        return cache.getArticle(slug, () -> loadArticle(slug));
    }

    private ArticleDetail loadArticle(String slug) {
        ContentItemRecord row = repository.findPublished("ARTICLE", slug);
        if (row == null) throw new ContentNotFoundException("ARTICLE_NOT_FOUND", "Article not found: " + slug);
        return ArticleDetail.from(toArticleSummary(row), row.contentMarkdown());
    }

    public ChatterPageResponse listChatter(int page, int size, String query) {
        validatePage(page, size, query);
        PageRows<ContentItemRecord> result = repository.listChatter(page, size, normalizeOptional(query));
        List<ChatterSummary> summaries = result.rows().stream().map(ContentReadService::toChatterSummary).toList();
        return new ChatterPageResponse(summaries, page, size, result.totalElements(), totalPages(size, result.totalElements()));
    }

    public ChatterDetail chatter(String slug) {
        return cache.getChatter(slug, () -> loadChatter(slug));
    }

    private ChatterDetail loadChatter(String slug) {
        ContentItemRecord row = repository.findPublished("CHATTER", slug);
        if (row == null) throw new ContentNotFoundException("CHATTER_NOT_FOUND", "Chatter not found: " + slug);
        ChatterSummary summary = toChatterSummary(row);
        return ChatterDetail.from(summary, row.contentMarkdown());
    }

    /** 搜索只允许公开类型，空关键词与错误类型使用已有的错误码。 */
    public ContentSearchPageResponse search(String query, String type, int page, int size) {
        if (query == null || query.isBlank()) {
            throw new ApiBadRequestException("CONTENT_EMPTY_QUERY", "Search query cannot be empty");
        }
        validatePage(page, size, query);

        // Python 端按大写比较类型，因此这里也允许 article、Chatter 等大小写写法。
        String normalizedType = type == null ? "ALL" : type.toUpperCase(Locale.ROOT);
        if (!List.of("ARTICLE", "CHATTER", "ALL").contains(normalizedType)) {
            throw new ApiBadRequestException("CONTENT_INVALID_TYPE", "type must be ARTICLE, CHATTER or ALL");
        }

        String normalizedQuery = query.strip();
        PageRows<ContentItemRecord> result = repository.search(normalizedQuery, normalizedType, page, size);
        List<ContentSearchResult> matches = result.rows().stream().map(this::toSearchResult).toList();
        return new ContentSearchPageResponse(matches, page, size, result.totalElements(), totalPages(size, result.totalElements()));
    }

    private ArticleSummary toArticleSummary(ContentItemRecord row) {
        return new ArticleSummary(
                row.id(), row.slug(), row.title() == null ? "" : row.title(), row.summary(),
                publicCoverUrl(row.slug(), row.coverPath()), row.coverColor(), row.tags(), row.status(),
                row.publishedAt(), row.createdAt(), row.updatedAt()
        );
    }

    private static ChatterSummary toChatterSummary(ContentItemRecord row) {
        return new ChatterSummary(
                row.id(), row.slug(), row.preview(), row.status(),
                row.publishedAt(), row.createdAt(), row.updatedAt()
        );
    }

    private ContentSearchResult toSearchResult(ContentItemRecord row) {
        boolean article = "ARTICLE".equals(row.contentType());
        return new ContentSearchResult(
                row.contentType(), row.id(), row.slug(), row.title(), row.preview(),
                row.summary(), article ? publicCoverUrl(row.slug(), row.coverPath()) : null,
                row.tags(), row.status(), row.publishedAt(), row.createdAt(), row.updatedAt(),
                article ? row.coverColor() : null
        );
    }

    private String publicCoverUrl(String slug, String storedCoverPath) {
        if (storedCoverPath == null || storedCoverPath.isBlank()) return null;

        // 将存储路径转换为相对路径，去除前导斜杠和文章前缀。
        String relative = storedCoverPath.replace('\\', '/').replaceFirst("^/+", "");
        String prefixedFolder = "articles/" + slug + "/";
        // 如果相对路径以文章前缀开头，则去掉前缀，否则返回 null。
        if (relative.startsWith(prefixedFolder)) relative = relative.substring(prefixedFolder.length());
        if (relative.isBlank()) return null;

        // 检查文件是否存在于文章目录中，防止通过符号链接访问目录外的文件。
        try {
            Path realRoot = articleRoot.toRealPath();
            Path candidate = articleRoot.resolve(slug).resolve(relative).normalize();
            if (!candidate.startsWith(articleRoot) || !Files.isRegularFile(candidate)) return null;
            // 真实路径检查也能拦住通过符号链接跳出媒体目录的访问。
            if (!candidate.toRealPath().startsWith(realRoot)) return null;
            return "/articles/" + slug + "/" + relative;
        } catch (IOException exception) {
            return null;
        }
    }

    //处理页数、每页大小、关键词检测不合法
    private static void validatePage(int page, int size, String query) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE || (query != null && query.length() > MAX_QUERY_LENGTH)) {
            throw new ApiBadRequestException("Invalid request parameters");
        }
    }

    private static String normalizeOptional(String value) {
        if (value == null || value.isBlank()) return null;
        return value.strip();
    }

    // 计算总页数，totalElements 为总记录数，size 为每页大小。
    private static int totalPages(int size, long totalElements) {
        if (totalElements == 0) return 0;
        return (int) ((totalElements + size - 1) / size);
    }
}
