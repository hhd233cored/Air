package org.airchord.backend.content;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

/** 公开内容的 JDBC 仓储；SQL 负责筛选与分页，服务层负责转换为 API DTO。 */
@Repository
public class ContentReadRepository {

    // 列表只读取写入时生成的预览，不把长 Markdown 正文加载到 JVM。
    private static final String LIST_COLUMNS = """
            SELECT content_type, id, slug, title, summary, cover_path, cover_color,
                   tags::text AS tags_json, status, published_at, created_at, updated_at,
                   NULL::text AS content_markdown, preview
            FROM content_items
            """;
    // 仅详情选择完整正文。
    private static final String CONTENT_COLUMNS = """
            SELECT content_type, id, slug, title, summary, cover_path, cover_color,
                   tags::text AS tags_json, status, published_at, created_at, updated_at,
                   content_markdown, preview
            FROM content_items
            """;
    private static final JsonMapper JSON_MAPPER = JsonMapper.builder().build();

    private final JdbcClient jdbcClient;
    private final JdbcTemplate jdbcTemplate;

    public ContentReadRepository(JdbcClient jdbcClient, JdbcTemplate jdbcTemplate) {
        this.jdbcClient = jdbcClient;
        this.jdbcTemplate = jdbcTemplate;
    }

    // 文章列表按发布时间倒序，可选按标签或正文内容过滤。
    public PageRows<ContentItemRecord> listArticles(int page, int size, String tag, String query) {
        StringBuilder where = new StringBuilder(publicWhere("ARTICLE"));
        if (tag != null) {
            // tags 是 JSONB 数组；大小写不敏感地检查标签是否存在。
            where.append(" AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) AS item(value) WHERE lower(item.value) = lower(:tag))");
        }
        if (query != null) {
            where.append(" AND POSITION(lower(:query) IN lower(concat_ws(E'\\n', id, title, summary, tags::text, content_markdown))) > 0");
        }
        return selectPage(new BoundQuery(where.toString(), "ARTICLE", tag, query), page, size, LIST_COLUMNS);
    }

    // 说说列表的搜索行为，按 Markdown 正文做大小写不敏感包含匹配。
    public PageRows<ContentItemRecord> listChatter(int page, int size, String query) {
        StringBuilder where = new StringBuilder(publicWhere("CHATTER"));
        if (query != null) {
            where.append(" AND POSITION(lower(:query) IN lower(content_markdown)) > 0");
        }
        return selectPage(new BoundQuery(where.toString(), "CHATTER", null, query), page, size, LIST_COLUMNS);
    }

    /**
     * 全文匹配与字面包含匹配保持原有并集语义；后者改走数据库维护的 trigram 搜索列。
     * 类型为 ALL 时省掉恒真的参数 OR，让 PostgreSQL 更容易估算筛选比例。
     */
    public PageRows<ContentItemRecord> search(String query, String type, int page, int size) {
        String typeWhere = switch (type) {
            case "ALL" -> "";
            case "ARTICLE", "CHATTER" -> "content_type = :type AND ";
            default -> throw new IllegalArgumentException("Unsupported search type: " + type);
        };
        String where = typeWhere + """
                status = 'PUBLISHED'
                AND deleted_at IS NULL
                AND (
                    search_document @@ phraseto_tsquery('simple', :query)
                    OR search_literal_lc LIKE '%' || lower(:escapedQuery) || '%' ESCAPE '!'
                )
                """;
        return selectPage(new BoundQuery(where, type, null, query), page, size, LIST_COLUMNS);
    }

    public ContentItemRecord findPublished(String type, String slug) {
        String sql = CONTENT_COLUMNS + """
                WHERE content_type = :type
                  AND lower(trim(slug)) = lower(trim(:slug))
                  AND status = 'PUBLISHED'
                  AND deleted_at IS NULL
                LIMIT 1
                """;
        return jdbcClient.sql(sql)
                .param("type", type)
                .param("slug", slug)
                .query((resultSet, rowNumber) -> mapContentItem(resultSet))
                .optional()
                .orElse(null);
    }

    /** 编辑器可读取草稿与归档；公开读取仍使用 findPublished，避免越权暴露。 */
    public ContentItemRecord findForEditor(String type, String slug) {
        return jdbcClient.sql(CONTENT_COLUMNS + " WHERE content_type = :type AND lower(slug) = lower(:slug) AND deleted_at IS NULL LIMIT 1")
                .param("type", type).param("slug", slug)
                .query((rs, row) -> mapContentItem(rs)).optional().orElse(null);
    }

    public PageRows<ContentItemRecord> listForEditor(String type, int page, int size, String query) {
        String where = "content_type = :type AND deleted_at IS NULL";
        if (query != null && !query.isBlank()) {
            where += " AND POSITION(lower(:query) IN lower(concat_ws(E'\\n', id, slug, title, summary, tags::text, content_markdown))) > 0";
        }
        BoundQuery bound = new BoundQuery(where, type, null, query);
        return selectPage(bound, page, size, LIST_COLUMNS);
    }

    /** 只读事务启用 PostgreSQL 游标；afterCommit 中沿用绑定连接，避免每个保存请求额外占用连接。 */
    @Transactional(readOnly = true)
    public void forEachPublishedIndexEntry(String type, Consumer<ContentItemRecord> consumer) {
        jdbcTemplate.query(connection -> {
            var statement = connection.prepareStatement(LIST_COLUMNS + """
                    WHERE content_type = ? AND status = 'PUBLISHED' AND deleted_at IS NULL
                    ORDER BY published_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                    """);
            statement.setString(1, type);
            statement.setFetchSize(100);
            return statement;
        }, (org.springframework.jdbc.core.RowCallbackHandler) rs -> consumer.accept(mapContentItem(rs)));
    }

    /** 唯一键保证并发编辑器请求不会创建两个相同类型与 slug 的条目。 */
    public void insertEditor(ContentItemRecord item, String preview, String coverPath) {
        jdbcClient.sql("""
                        INSERT INTO content_items (id, content_type, slug, title, summary, preview, cover_path,
                          cover_color, tags, status, content_markdown, published_at, created_at, updated_at, deleted_at)
                        VALUES (:id, :type, :slug, :title, :summary, :preview, :coverPath, :coverColor,
                          CAST(:tags AS jsonb), :status, :markdown, CAST(:publishedAt AS timestamptz),
                          CAST(:createdAt AS timestamptz), CAST(:updatedAt AS timestamptz), NULL)
                        """)
                .param("id", item.id() == null ? UUID.randomUUID().toString() : item.id())
                .param("type", item.contentType()).param("slug", item.slug()).param("title", item.title())
                .param("summary", item.summary()).param("preview", preview).param("coverPath", coverPath)
                .param("coverColor", item.coverColor()).param("tags", JSON_MAPPER.writeValueAsString(item.tags()))
                .param("status", item.status()).param("markdown", item.contentMarkdown())
                .param("publishedAt", item.publishedAt()).param("createdAt", item.createdAt())
                .param("updatedAt", item.updatedAt()).update();
    }

    /** 用主键更新同一条内容，Slug 重命名时不会留下旧 Slug 的第二条记录。 */
    public void updateEditor(ContentItemRecord item, String preview, String coverPath) {
        jdbcClient.sql("""
                        UPDATE content_items SET slug = :slug, title = :title, summary = :summary, preview = :preview,
                          cover_path = :coverPath, cover_color = :coverColor, tags = CAST(:tags AS jsonb),
                          status = :status, content_markdown = :markdown,
                          published_at = CAST(:publishedAt AS timestamptz),
                          updated_at = CAST(:updatedAt AS timestamptz), deleted_at = NULL
                        WHERE id = :id AND content_type = :type AND deleted_at IS NULL
                        """)
                .param("id", item.id()).param("type", item.contentType()).param("slug", item.slug())
                .param("title", item.title()).param("summary", item.summary()).param("preview", preview)
                .param("coverPath", coverPath).param("coverColor", item.coverColor())
                .param("tags", JSON_MAPPER.writeValueAsString(item.tags())).param("status", item.status())
                .param("markdown", item.contentMarkdown()).param("publishedAt", item.publishedAt())
                .param("updatedAt", item.updatedAt()).update();
    }

    public boolean hasComments(String type, String slug) {
        return jdbcClient.sql("SELECT EXISTS(SELECT 1 FROM comments WHERE target_type = :type AND target_id = :slug)")
                .param("type", type).param("slug", slug).query(Boolean.class).single();
    }

    public void softDeleteEditor(String type, String slug) {
        jdbcClient.sql("UPDATE content_items SET deleted_at = now(), updated_at = now() WHERE content_type = :type AND slug = :slug AND deleted_at IS NULL")
                .param("type", type).param("slug", slug).update();
    }

    // 同一个 WHERE 条件分别用于总数与分页数据，保证 totalElements 和 content 一致。
    private PageRows<ContentItemRecord> selectPage(BoundQuery query, int page, int size, String columns) {
        long total = count(query);
        List<ContentItemRecord> rows = fetch(query, page, size, columns);
        return new PageRows<>(rows, total);
    }

    private long count(BoundQuery query) {
        var statement = jdbcClient.sql("SELECT COUNT(*) FROM content_items WHERE " + query.where());
        bind(statement, query);
        return statement.query(Long.class).single();
    }

    
    private List<ContentItemRecord> fetch(BoundQuery query, int page, int size, String columns) {
        String sql = columns + """
                WHERE %s
                ORDER BY published_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                LIMIT :size OFFSET :offset
                """.formatted(query.where());
        var statement = jdbcClient.sql(sql)
                .param("size", size)
                .param("offset", (long) page * size);
        bind(statement, query);
        return statement.query((resultSet, rowNumber) -> mapContentItem(resultSet)).list();
    }

    // 绑定查询参数，避免 SQL 注入。JdbcClient 会自动处理大小写、引号和转义。
    private static void bind(JdbcClient.StatementSpec statement, BoundQuery query) {
        statement.param("type", query.type());
        if (query.tag() != null) statement.param("tag", query.tag());
        if (query.query() != null) {
            statement.param("query", query.query());
            statement.param("escapedQuery", escapeLikeLiteral(query.query()));
        }
    }

    /** LIKE 中的 %, _ 和转义符本身必须当作普通字符，才能与旧 POSITION 语义一致。 */
    private static String escapeLikeLiteral(String value) {
        return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }

    private static String publicWhere(String type) {
        return "content_type = '" + type + "' AND status = 'PUBLISHED' AND deleted_at IS NULL";
    }

    private ContentItemRecord mapContentItem(ResultSet resultSet) throws SQLException {
        return new ContentItemRecord(
                resultSet.getString("content_type"), resultSet.getString("id"),
                resultSet.getString("slug"), resultSet.getString("title"),
                resultSet.getString("summary"), resultSet.getString("cover_path"),
                resultSet.getString("cover_color"), parseTags(resultSet.getString("tags_json")),
                resultSet.getString("status"), timestamp(resultSet, "published_at"),
                timestamp(resultSet, "created_at"), timestamp(resultSet, "updated_at"),
                resultSet.getString("content_markdown"), resultSet.getString("preview")
        );
    }

    private static String timestamp(ResultSet resultSet, String column) throws SQLException {
        // PostgreSQL TIMESTAMPTZ 映射到 OffsetDateTime，再统一序列化为 UTC ISO-8601 字符串。
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant().toString();
    }

    private static List<String> parseTags(String tagsJson) throws SQLException {
        // 让 JSON 解析器处理引号、中文和转义，不手工拆分 JSON 文本。
        try {
            String[] values = JSON_MAPPER.readValue(tagsJson, String[].class);
            return new ArrayList<>(new LinkedHashSet<>(Arrays.stream(values)
                    .map(String::strip)
                    .filter(value -> !value.isEmpty())
                    .toList()));
        } catch (Exception exception) {
            throw new SQLException("无法读取内容标签 JSON", exception);
        }
    }

    public record PageRows<T>(List<T> rows, long totalElements) {
    }

    private record BoundQuery(String where, String type, String tag, String query) {
    }
}
