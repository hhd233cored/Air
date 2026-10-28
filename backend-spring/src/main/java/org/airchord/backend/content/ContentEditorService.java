package org.airchord.backend.content;

import org.airchord.backend.content.ContentReadRepository.PageRows;
import org.airchord.backend.web.BackendApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.*;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * 管理员编辑文章与说说。PostgreSQL 是正文和元数据主存储，Markdown/JSON 与媒体目录是兼容备份。
 * 文件先写临时目录；数据库事务提交后保留新目录，失败则恢复旧目录。
 */
@Service
public class ContentEditorService {
    private static final Pattern SLUG = Pattern.compile("^[a-z0-9]+(?:-[a-z0-9]+)*$");
    private static final Set<String> COVER_EXTENSIONS = Set.of(".svg", ".png", ".jpg", ".jpeg", ".webp");
    private static final Set<String> ASSET_EXTENSIONS = Set.of(".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif");
    private static final Set<String> STATUSES = Set.of("DRAFT", "PUBLISHED", "ARCHIVED");
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String ARTICLE = "ARTICLE";
    private static final String CHATTER = "CHATTER";
    private static final System.Logger LOGGER = System.getLogger(ContentEditorService.class.getName());
    private final Object articleIndexLock = new Object();
    private final Object chatterIndexLock = new Object();

    private final ContentReadRepository repository;
    private final ApplicationEventPublisher events;
    private final Path articlesRoot;
    private final Path chatterRoot;
    private final boolean enabled;
    private final long maxRequestBytes;

    public ContentEditorService(ContentReadRepository repository, ApplicationEventPublisher events,
                                @Value("${airchord.media.articles-dir:../public/articles}") String articlesRoot,
                                @Value("${airchord.media.chatter-dir:../public/chatter}") String chatterRoot,
                                @Value("${airchord.editor.enabled:false}") boolean enabled,
                                @Value("${airchord.editor.upload-max-bytes:104857600}") long maxRequestBytes) {
        this.repository = repository; this.events = events;
        this.articlesRoot = Path.of(articlesRoot).toAbsolutePath().normalize();
        this.chatterRoot = Path.of(chatterRoot).toAbsolutePath().normalize();
        this.enabled = enabled; this.maxRequestBytes = maxRequestBytes;
    }

    public ArticlePageResponse listArticles(int page, int size, String query) {
        checkEnabled(); validatePage(page, size);
        PageRows<ContentItemRecord> rows = repository.listForEditor(ARTICLE, page, size, normalize(query));
        return new ArticlePageResponse(rows.rows().stream().map(this::articleSummary).toList(), page, size,
                rows.totalElements(), pages(rows.totalElements(), size));
    }

    public ArticleDetail getArticle(String slug) {
        ContentItemRecord row = require(ARTICLE, slug);
        return ArticleDetail.from(articleSummary(row), row.contentMarkdown());
    }

    public ChatterPageResponse listChatter(int page, int size, String query) {
        checkEnabled(); validatePage(page, size);
        PageRows<ContentItemRecord> rows = repository.listForEditor(CHATTER, page, size, normalize(query));
        return new ChatterPageResponse(rows.rows().stream().map(ContentEditorService::chatterSummary).toList(), page, size,
                rows.totalElements(), pages(rows.totalElements(), size));
    }

    public ChatterDetail getChatter(String slug) {
        ContentItemRecord row = require(CHATTER, slug);
        return ChatterDetail.from(chatterSummary(row), row.contentMarkdown());
    }

    @Transactional
    public ArticleDetail createArticle(String title, String slug, String summary, String tags, String status,
                                       String publishedAt, String markdown, MultipartFile cover,
                                       List<MultipartFile> assets) {
        checkEnabled();
        String cleanTitle = required(title, "INVALID_TITLE", "Title is required");
        String cleanSlug = normalizeSlug(hasText(slug) ? slug : slugFromTitle(cleanTitle));
        if (repository.findForEditor(ARTICLE, cleanSlug) != null || Files.exists(folder(articlesRoot, cleanSlug))) conflict(cleanSlug);
        if (cover == null || cover.isEmpty()) throw error("COVER_REQUIRED", "文章需要封面图片", 400);
        checkRequestSize(cover, assets);
        String coverName = safeFilename(cover.getOriginalFilename(), COVER_EXTENSIONS);
        String now = Instant.now().toString();
        String cleanStatus = status(status, "DRAFT");
        String published = publishedAt(publishedAt, cleanStatus, null);
        ContentItemRecord item = new ContentItemRecord(ARTICLE, UUID.randomUUID().toString(), cleanSlug,
                cleanTitle, normalize(summary), null, null, parseTags(tags), cleanStatus, published, now, now,
                markdown == null ? "" : markdown);
        writeWithDirectory(articlesRoot, null, cleanSlug, staged -> {
            writeUpload(cover, staged.resolve(coverName));
            writeAssets(assets, staged.resolve("assets"));
            writeText(staged.resolve("article.md"), item.contentMarkdown());
            writeMetadata(staged.resolve("article.json"), articleMetadata(item, coverName));
        });
        try { repository.insertEditor(item, MarkdownPreview.from(item.contentMarkdown()), "articles/" + cleanSlug + "/" + coverName); }
        catch (DuplicateKeyException ex) { conflict(cleanSlug); }
        publishChange(ARTICLE, List.of(cleanSlug));
        return getArticle(cleanSlug);
    }

    @Transactional
    public ArticleDetail updateArticle(String slug, String title, String newSlug, String summary, String tags,
                                       String status, String publishedAt, String markdown, MultipartFile cover,
                                       List<MultipartFile> assets) {
        checkEnabled();
        ContentItemRecord old = require(ARTICLE, slug);
        String cleanTitle = required(title, "INVALID_TITLE", "Title is required");
        String cleanSlug = normalizeSlug(hasText(newSlug) ? newSlug : old.slug());
        checkSlugChange(ARTICLE, old, cleanSlug);
        checkRequestSize(cover, assets);
        String coverName = cover != null && !cover.isEmpty() ? safeFilename(cover.getOriginalFilename(), COVER_EXTENSIONS)
                : existingCoverName(old.coverPath(), old.slug());
        if ((coverName == null || !Files.isRegularFile(folder(articlesRoot, old.slug()).resolve(coverName)))
                && (cover == null || cover.isEmpty())) throw error("COVER_REQUIRED", "文章需要封面图片", 400);
        String cleanStatus = status(status, old.status());
        String published = publishedAt(publishedAt, cleanStatus, old.publishedAt());
        String now = Instant.now().toString();
        ContentItemRecord item = new ContentItemRecord(ARTICLE, old.id(), cleanSlug, cleanTitle,
                summary == null ? old.summary() : normalize(summary), null, old.coverColor(),
                tags == null ? old.tags() : parseTags(tags), cleanStatus, published, old.createdAt(), now,
                markdown == null ? "" : markdown);
        writeWithDirectory(articlesRoot, old.slug(), cleanSlug, staged -> {
            if (cover != null && !cover.isEmpty()) writeUpload(cover, staged.resolve(coverName));
            if (assets != null && !assets.isEmpty()) writeAssets(assets, staged.resolve("assets"));
            writeText(staged.resolve("article.md"), item.contentMarkdown());
            writeMetadata(staged.resolve("article.json"), articleMetadata(item, coverName));
        });
        try { repository.updateEditor(item, MarkdownPreview.from(item.contentMarkdown()), "articles/" + cleanSlug + "/" + coverName); }
        catch (DuplicateKeyException ex) { conflict(cleanSlug); }
        publishChange(ARTICLE, old.slug().equals(cleanSlug) ? List.of(cleanSlug) : List.of(old.slug(), cleanSlug));
        return getArticle(cleanSlug);
    }

    @Transactional
    public ChatterDetail createChatter(String slug, String status, String publishedAt, String markdown,
                                       List<MultipartFile> assets) {
        checkEnabled();
        String body = required(markdown, "INVALID_CONTENT", "Chatter content is required");
        String cleanSlug = normalizeSlug(hasText(slug) ? slug : slugFromTitle(MarkdownPreview.from(body)));
        if (repository.findForEditor(CHATTER, cleanSlug) != null || Files.exists(folder(chatterRoot, cleanSlug))) conflict(cleanSlug);
        checkRequestSize(null, assets);
        String now = Instant.now().toString();
        String cleanStatus = status(status, "DRAFT");
        ContentItemRecord item = new ContentItemRecord(CHATTER, "chatter-" + UUID.randomUUID(), cleanSlug,
                null, null, null, null, List.of(), cleanStatus, publishedAt(publishedAt, cleanStatus, null), now, now, body);
        writeWithDirectory(chatterRoot, null, cleanSlug, staged -> {
            writeAssets(assets, staged.resolve("assets"));
            writeText(staged.resolve("chatter.md"), body);
            writeMetadata(staged.resolve("chatter.json"), chatterMetadata(item));
        });
        try { repository.insertEditor(item, MarkdownPreview.from(body), null); }
        catch (DuplicateKeyException ex) { conflict(cleanSlug); }
        publishChange(CHATTER, List.of(cleanSlug));
        return getChatter(cleanSlug);
    }

    @Transactional
    public ChatterDetail updateChatter(String slug, String newSlug, String status, String publishedAt,
                                       String markdown, List<MultipartFile> assets) {
        checkEnabled();
        ContentItemRecord old = require(CHATTER, slug);
        String body = required(markdown, "INVALID_CONTENT", "Chatter content is required");
        String cleanSlug = normalizeSlug(hasText(newSlug) ? newSlug : old.slug());
        checkSlugChange(CHATTER, old, cleanSlug);
        checkRequestSize(null, assets);
        String cleanStatus = status(status, old.status());
        String now = Instant.now().toString();
        ContentItemRecord item = new ContentItemRecord(CHATTER, old.id(), cleanSlug, null, null, null, null,
                List.of(), cleanStatus, publishedAt(publishedAt, cleanStatus, old.publishedAt()), old.createdAt(), now, body);
        writeWithDirectory(chatterRoot, old.slug(), cleanSlug, staged -> {
            if (assets != null && !assets.isEmpty()) writeAssets(assets, staged.resolve("assets"));
            writeText(staged.resolve("chatter.md"), body);
            writeMetadata(staged.resolve("chatter.json"), chatterMetadata(item));
        });
        try { repository.updateEditor(item, MarkdownPreview.from(body), null); }
        catch (DuplicateKeyException ex) { conflict(cleanSlug); }
        publishChange(CHATTER, old.slug().equals(cleanSlug) ? List.of(cleanSlug) : List.of(old.slug(), cleanSlug));
        return getChatter(cleanSlug);
    }

    @Transactional
    public void delete(String type, String slug) {
        checkEnabled();
        ContentItemRecord row = require(type, slug);
        Path root = type.equals(ARTICLE) ? articlesRoot : chatterRoot;
        moveDirectoryForDelete(root, row.slug());
        repository.softDeleteEditor(type, row.slug());
        publishChange(type, List.of(row.slug()));
    }

    private void checkSlugChange(String type, ContentItemRecord old, String next) {
        if (old.slug().equals(next)) return;
        if (repository.findForEditor(type, next) != null || Files.exists(folder(type.equals(ARTICLE) ? articlesRoot : chatterRoot, next))) conflict(next);
        if (!"DRAFT".equals(old.status()) || repository.hasComments(type, old.slug()))
            throw error("EDITOR_SLUG_IMMUTABLE", "已发布、已归档或已有评论的内容不能修改 Slug", 409);
    }

    private void writeWithDirectory(Path root, String oldSlug, String newSlug, DirectoryWriter writer) {
        Path stage = root.resolve(".staging-" + UUID.randomUUID());
        Path target = folder(root, newSlug);
        Path old = oldSlug == null ? null : folder(root, oldSlug);
        Path backup = root.resolve(".rollback-" + UUID.randomUUID());
        boolean backedUp = false;
        boolean installed = false;
        try {
            Files.createDirectories(root);
            if (old != null && Files.isDirectory(old)) copyTree(old, stage);
            else Files.createDirectories(stage);
            writer.write(stage);
            if (Files.exists(target)) {
                if (old == null || !target.equals(old)) conflict(newSlug);
                move(target, backup);
                backedUp = true;
            } else if (old != null && Files.exists(old)) move(old, backup);
            if (!backedUp && old != null && Files.exists(backup)) backedUp = true;
            move(stage, target);
            installed = true;
            registerDirectoryCompensation(target, backup, old != null && Files.exists(backup), old == null ? target : old, root);
        } catch (BackendApiException ex) {
            cleanup(stage);
            if (installed) cleanup(target);
            if (backedUp) try { move(backup, old == null ? target : old); } catch (IOException ignored) { }
            throw ex;
        } catch (IOException ex) {
            cleanup(stage);
            if (installed) cleanup(target);
            if (backedUp) try { move(backup, old == null ? target : old); } catch (IOException ignored) { }
            throw error("EDITOR_FILE_WRITE_FAILED", "编辑器文件保存失败", 500);
        }
    }

    private void moveDirectoryForDelete(Path root, String slug) {
        Path target = folder(root, slug), backup = root.resolve(".deleted-" + UUID.randomUUID());
        if (!Files.exists(target)) return;
        try {
            move(target, backup);
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override public void afterCommit() { cleanup(backup); }
                    @Override public void afterCompletion(int status) {
                        if (status != STATUS_COMMITTED) try { move(backup, target); } catch (IOException ignored) { }
                    }
                });
            } else cleanup(backup);
        } catch (IOException ex) { throw error("EDITOR_DELETE_FAILED", "内容文件无法删除", 500); }
    }

    private void registerDirectoryCompensation(Path target, Path backup, boolean hadBackup, Path restorePath, Path root) {
        Runnable committed = () -> { if (hadBackup) cleanup(backup); rebuildIndex(root, target.getFileName().toString()); };
        Runnable rolledBack = () -> {
            cleanup(target);
            if (hadBackup) try { move(backup, restorePath); } catch (IOException ignored) { }
            rebuildIndex(root, target.getFileName().toString());
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { committed.run(); }
                @Override public void afterCompletion(int status) { if (status != STATUS_COMMITTED) rolledBack.run(); }
            });
        } else committed.run();
    }

    private void rebuildIndex(Path root, String slug) {
        boolean article = root.equals(articlesRoot);
        // 同一类型的重建串行执行，避免较早的数据库快照覆盖较新的索引。
        synchronized (article ? articleIndexLock : chatterIndexLock) {
            Path temp = root.resolve(".index-" + UUID.randomUUID() + ".tmp");
            try {
                try (var output = new java.io.BufferedOutputStream(Files.newOutputStream(temp));
                     var json = JSON.createGenerator(output)) {
                    json.writeStartArray();
                    repository.forEachPublishedIndexEntry(article ? ARTICLE : CHATTER, row ->
                            JSON.writeValue(json, article ? articleIndexEntry(articleSummary(row))
                                    : chatterIndexEntry(chatterSummary(row))));
                    json.writeEndArray();
                }
                move(temp, root.resolve("index.json"));
            } catch (Exception exception) {
                // 正文已经提交；保留上一个完整索引，清理失败的临时文件。
                LOGGER.log(System.Logger.Level.WARNING, "静态索引重建失败: " + root, exception);
            } finally {
                cleanup(temp);
            }
        }
    }

    private void publishChange(String type, List<String> slugs) {
        events.publishEvent(new PublicContentChangedEvent(type, slugs));
    }

    private ContentItemRecord require(String type, String slug) {
        checkEnabled();
        ContentItemRecord row = repository.findForEditor(type, slug);
        if (row == null) throw error(type.equals(ARTICLE) ? "EDITOR_ARTICLE_NOT_FOUND" : "EDITOR_CHATTER_NOT_FOUND", "编辑内容不存在", 404);
        return row;
    }

    private ArticleSummary articleSummary(ContentItemRecord row) {
        String coverUrl = null;
        String name = existingCoverName(row.coverPath(), row.slug());
        if (name != null && Files.isRegularFile(folder(articlesRoot, row.slug()).resolve(name))) coverUrl = "/articles/" + row.slug() + "/" + name;
        return new ArticleSummary(row.id(), row.slug(), row.title(), row.summary(), coverUrl,
                row.coverColor(), row.tags(), row.status(), row.publishedAt(), row.createdAt(), row.updatedAt());
    }

    private static ChatterSummary chatterSummary(ContentItemRecord row) {
        return new ChatterSummary(row.id(), row.slug(), row.preview(), row.status(),
                row.publishedAt(), row.createdAt(), row.updatedAt());
    }

    private Map<String, Object> articleMetadata(ContentItemRecord row, String cover) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", row.id()); value.put("slug", row.slug()); value.put("title", row.title());
        value.put("summary", row.summary()); value.put("tags", row.tags()); value.put("status", row.status());
        value.put("publishedAt", row.publishedAt()); value.put("createdAt", row.createdAt());
        value.put("updatedAt", row.updatedAt()); value.put("cover", cover); value.put("coverColor", row.coverColor());
        return value;
    }

    private static Map<String, Object> chatterMetadata(ContentItemRecord row) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", row.id()); value.put("slug", row.slug()); value.put("status", row.status());
        value.put("publishedAt", row.publishedAt()); value.put("createdAt", row.createdAt()); value.put("updatedAt", row.updatedAt());
        return value;
    }

    /** 静态 index.json 继续使用公开 API 摘要结构，而不是内部 article.json 备份结构。 */
    private static Map<String, Object> articleIndexEntry(ArticleSummary item) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", item.id()); value.put("slug", item.slug()); value.put("title", item.title());
        value.put("summary", item.summary()); value.put("coverUrl", item.coverUrl());
        value.put("coverColor", item.coverColor()); value.put("tags", item.tags()); value.put("status", item.status());
        value.put("publishedAt", item.publishedAt()); value.put("createdAt", item.createdAt());
        value.put("updatedAt", item.updatedAt());
        return value;
    }

    private static Map<String, Object> chatterIndexEntry(ChatterSummary item) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", item.id()); value.put("slug", item.slug()); value.put("preview", item.preview());
        value.put("status", item.status()); value.put("publishedAt", item.publishedAt());
        value.put("createdAt", item.createdAt()); value.put("updatedAt", item.updatedAt());
        return value;
    }

    private static void writeAssets(List<MultipartFile> assets, Path assetsDirectory) throws IOException {
        if (assets == null || assets.isEmpty()) return;
        for (MultipartFile asset : assets) {
            if (asset == null || asset.isEmpty() || !hasText(asset.getOriginalFilename())) continue;
            String name = safeFilename(asset.getOriginalFilename(), ASSET_EXTENSIONS);
            Files.createDirectories(assetsDirectory); writeUpload(asset, assetsDirectory.resolve(name));
        }
    }

    private static void writeUpload(MultipartFile upload, Path target) throws IOException {
        Files.createDirectories(target.getParent());
        Path tmp = target.resolveSibling("." + target.getFileName() + ".tmp-" + UUID.randomUUID());
        try (InputStream in = upload.getInputStream()) { Files.copy(in, tmp); }
        move(tmp, target);
    }

    private static void writeText(Path target, String content) throws IOException {
        Files.createDirectories(target.getParent());
        Path tmp = target.resolveSibling("." + target.getFileName() + ".tmp-" + UUID.randomUUID());
        Files.writeString(tmp, content == null ? "" : content, java.nio.charset.StandardCharsets.UTF_8);
        move(tmp, target);
    }

    private static void writeMetadata(Path target, Object metadata) throws IOException {
        writeText(target, JSON.writerWithDefaultPrettyPrinter().writeValueAsString(metadata) + "\n");
    }

    private static void copyTree(Path source, Path destination) throws IOException {
        try (Stream<Path> files = Files.walk(source)) {
            for (Path file : files.toList()) {
                // Files.copy 默认会跟随文件符号链接，可能把媒体根目录之外的文件复制进新版本。
                // 编辑器目录由应用维护，遇到链接直接失败，要求资源都落在受控目录内。
                if (Files.isSymbolicLink(file)) throw new IOException("编辑器媒体目录不允许符号链接");
                Path target = destination.resolve(source.relativize(file).toString());
                if (Files.isDirectory(file)) Files.createDirectories(target);
                else { Files.createDirectories(target.getParent()); Files.copy(file, target, StandardCopyOption.REPLACE_EXISTING); }
            }
        }
    }

    private static void move(Path source, Path destination) throws IOException {
        Files.createDirectories(destination.getParent());
        try { Files.move(source, destination, StandardCopyOption.ATOMIC_MOVE); }
        catch (AtomicMoveNotSupportedException ex) { Files.move(source, destination, StandardCopyOption.REPLACE_EXISTING); }
    }

    private static void cleanup(Path... paths) {
        for (Path path : paths) if (path != null) try {
            if (Files.isDirectory(path)) try (Stream<Path> walk = Files.walk(path)) {
                for (Path item : walk.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(item);
            } else Files.deleteIfExists(path);
        } catch (IOException ignored) { }
    }

    private static String safeFilename(String filename, Set<String> allowed) {
        String base = filename == null ? "" : Path.of(filename.replace('\\', '/')).getFileName().toString();
        String safe = base.replaceAll("[^A-Za-z0-9._-]", "-").replaceAll("^\\.+|\\.+$", "");
        int dot = safe.lastIndexOf('.');
        String ext = dot < 0 ? "" : safe.substring(dot).toLowerCase(Locale.ROOT);
        if (safe.isBlank() || !allowed.contains(ext)) throw error("INVALID_FILE", "文件名无效或文件格式不支持", 400);
        return safe;
    }

    private static String existingCoverName(String coverPath, String slug) {
        if (coverPath == null || coverPath.isBlank()) return null;
        String normalized = coverPath.replace('\\', '/');
        String prefix = "articles/" + slug + "/";
        if (normalized.startsWith(prefix)) normalized = normalized.substring(prefix.length());
        if (normalized.contains("/") || normalized.contains("..")) return null;
        return normalized;
    }

    private static List<String> parseTags(String raw) {
        if (!hasText(raw)) return List.of();
        String value = raw.strip();
        try {
            if (value.startsWith("[")) {
                String[] tags = JSON.readValue(value, String[].class);
                return Arrays.stream(tags).map(String::strip).filter(s -> !s.isEmpty()).distinct().toList();
            }
        } catch (Exception ex) { throw error("INVALID_TAGS", "标签需要是逗号分隔文本或 JSON 字符串数组", 400); }
        return Arrays.stream(value.split(",")).map(String::strip).filter(s -> !s.isEmpty()).distinct().toList();
    }

    private static String publishedAt(String value, String status, String old) {
        if (hasText(value)) {
            try { return OffsetDateTime.parse(value.strip()).toInstant().toString(); }
            catch (DateTimeParseException ex) {
                try { return Instant.parse(value.strip()).toString(); }
                catch (DateTimeParseException ignored) { throw error("INVALID_TIMESTAMP", "publishedAt 必须是 ISO 时间", 400); }
            }
        }
        if ("PUBLISHED".equals(status)) return old == null ? Instant.now().toString() : old;
        return null;
    }

    private static String status(String raw, String fallback) {
        String status = hasText(raw) ? raw.strip().toUpperCase(Locale.ROOT) : fallback;
        if (!STATUSES.contains(status)) throw error("INVALID_STATUS", "状态必须为 DRAFT、PUBLISHED 或 ARCHIVED", 400);
        return status;
    }

    private static String normalizeSlug(String value) {
        String slug = value == null ? "" : value.strip().toLowerCase(Locale.ROOT);
        if (!SLUG.matcher(slug).matches()) throw error("INVALID_SLUG", "Slug 只能包含小写字母、数字和单个连字符", 400);
        return slug;
    }

    private static String slugFromTitle(String title) {
        String slug = title.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
        return slug.isBlank() ? "content-" + UUID.randomUUID().toString().substring(0, 8)
                : slug.substring(0, Math.min(80, slug.length())).replaceAll("-+$", "");
    }

    private static String required(String value, String code, String message) {
        if (!hasText(value)) throw error(code, message, 400);
        return value.strip();
    }
    private static boolean hasText(String value) { return value != null && !value.isBlank(); }
    private static String normalize(String value) { return hasText(value) ? value.strip() : null; }
    private void checkEnabled() { if (!enabled) throw error("EDITOR_DISABLED", "本地内容编辑器未开启", 404); }
    private void checkRequestSize(MultipartFile cover, List<MultipartFile> assets) {
        long total = cover == null ? 0 : cover.getSize();
        if (assets != null) for (MultipartFile asset : assets) if (asset != null) total += asset.getSize();
        if (total > maxRequestBytes) throw error("EDITOR_UPLOAD_TOO_LARGE", "编辑器单次上传总量不能超过 100 MiB", 413);
    }
    private static void validatePage(int page, int size) { if (page < 0 || size < 1 || size > 100) throw error("BAD_REQUEST", "分页参数无效", 400); }
    private static int pages(long total, int size) { return total == 0 ? 0 : (int) ((total + size - 1) / size); }
    private static Path folder(Path root, String slug) { return root.resolve(normalizeSlug(slug)).normalize(); }
    private static void conflict(String slug) { throw error("EDITOR_ARTICLE_EXISTS", "内容 Slug 已存在: " + slug, 409); }
    private static BackendApiException error(String code, String message, int status) { return new BackendApiException(code, message, status); }
    @FunctionalInterface private interface DirectoryWriter { void write(Path staged) throws IOException; }
}
