package org.airchord.backend.content;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** 独立 schema 对照旧 SQL，确保 trigram 优化没有改变全文、中文和字面搜索的结果。 */
@EnabledIfEnvironmentVariable(named = "AIRCHORD_TEST_JDBC_URL", matches = ".+")
class SearchSqlIntegrationTest {
    private static final String OLD_WHERE = """
            (:type = 'ALL' OR content_type = :type)
            AND status = 'PUBLISHED' AND deleted_at IS NULL
            AND (search_document @@ phraseto_tsquery('simple', :query)
                 OR POSITION(lower(:query) IN lower(concat_ws(E'\\n', id, slug, content_type,
                     title, summary, tags::text, content_markdown))) > 0)
            """;

    @Test
    void optimizedSearchKeepsOldResultsAndTriggerUpdatesLiteralText() {
        String url = System.getenv("AIRCHORD_TEST_JDBC_URL");
        String user = System.getenv("AIRCHORD_TEST_DB_USER");
        String password = System.getenv("AIRCHORD_TEST_DB_PASSWORD");
        var admin = new DriverManagerDataSource(url, user, password);
        var adminJdbc = new JdbcTemplate(admin);
        String schema = "search_test_" + UUID.randomUUID().toString().replace("-", "");
        adminJdbc.execute("CREATE SCHEMA " + schema);
        try {
            var source = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?")
                    + "currentSchema=" + schema, user, password);
            Flyway.configure().dataSource(source).defaultSchema(schema)
                    .locations("classpath:db/migration", "classpath:db/fixtures").load().migrate();
            var jdbc = JdbcClient.create(source);
            var repository = new ContentReadRepository(jdbc, new JdbcTemplate(source));

            // 百分号、下划线和感叹号容易被 LIKE 当作通配符或转义符。
            insert(jdbc, "search-edge-article", "ARTICLE", "PUBLISHED", false,
                    "100% 完成 a_b!", "中文短词 春天里，Foo Bar。", "[\"测试\",\"春天\"]");
            insert(jdbc, "search-edge-chatter", "CHATTER", "PUBLISHED", false,
                    null, "春天里有 100% 的 a_b!", "[]");
            insert(jdbc, "search-edge-draft", "ARTICLE", "DRAFT", false,
                    "只有草稿 secret", "隐藏内容", "[]");
            insert(jdbc, "search-edge-deleted", "ARTICLE", "PUBLISHED", true,
                    "已经删除 secret", "隐藏内容", "[]");

            assertLiteralColumnMatchesOldExpression(jdbc);
            for (String query : List.of("Spring", "spring", "春", "春天", "春天里", "100%", "%", "_",
                    "!", "a_b", "Foo Bar", "secret", "PUBLISHED", "\\", "missing-keyword")) {
                for (String type : List.of("ALL", "ARTICLE", "CHATTER")) {
                    assertSameResults(jdbc, repository, query, type, 0, 2);
                    assertSameResults(jdbc, repository, query, type, 1, 2);
                    assertSameResults(jdbc, repository, query, type, 10, 2);
                }
            }

            // 编辑器更新正文、标题和标签后，触发器应同步修改索引输入。
            jdbc.sql("""
                    UPDATE content_items SET title = '更新后的标题', content_markdown = '新正文 qwerty987',
                        tags = '["新标签"]'::jsonb WHERE id = 'search-edge-article'
                    """).update();
            assertLiteralColumnMatchesOldExpression(jdbc);
            assertSameResults(jdbc, repository, "qwerty987", "ALL", 0, 10);
            assertSameResults(jdbc, repository, "新标签", "ARTICLE", 0, 10);
            assertThat(repository.search("qwerty987", "ALL", 0, 10).rows())
                    .extracting(ContentItemRecord::id).contains("search-edge-article");

            Long indexes = jdbc.sql("""
                    SELECT count(*) FROM pg_indexes
                    WHERE schemaname = current_schema() AND indexname = 'content_items_public_literal_trgm_idx'
                    """).query(Long.class).single();
            assertThat(indexes).isEqualTo(1);
        } finally {
            adminJdbc.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }

    private void insert(JdbcClient jdbc, String id, String type, String status, boolean deleted,
                        String title, String body, String tags) {
        jdbc.sql("""
                INSERT INTO content_items (id, content_type, slug, title, summary, tags, status,
                    content_markdown, published_at, created_at, updated_at, deleted_at)
                VALUES (:id, :type, :id, :title, '虚构搜索参照', CAST(:tags AS jsonb), :status,
                    :body, now(), now(), now(), CASE WHEN :deleted THEN now() ELSE NULL END)
                """).param("id", id).param("type", type).param("title", title).param("tags", tags)
                .param("status", status).param("body", body).param("deleted", deleted).update();
    }

    private void assertLiteralColumnMatchesOldExpression(JdbcClient jdbc) {
        Long differences = jdbc.sql("""
                SELECT count(*) FROM content_items
                WHERE search_literal_lc IS DISTINCT FROM lower(concat_ws(E'\\n', id, slug, content_type,
                    title, summary, tags::text, content_markdown))
                """).query(Long.class).single();
        assertThat(differences).isZero();
    }

    private void assertSameResults(JdbcClient jdbc, ContentReadRepository repository,
                                   String query, String type, int page, int size) {
        long oldTotal = jdbc.sql("SELECT count(*) FROM content_items WHERE " + OLD_WHERE)
                .param("type", type).param("query", query).query(Long.class).single();
        List<String> oldIds = jdbc.sql("""
                SELECT id FROM content_items WHERE %s
                ORDER BY published_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                LIMIT :size OFFSET :offset
                """.formatted(OLD_WHERE)).param("type", type).param("query", query)
                .param("size", size).param("offset", page * size).query(String.class).list();
        var actual = repository.search(query, type, page, size);
        assertThat(actual.totalElements()).as("query=%s type=%s page=%s", query, type, page).isEqualTo(oldTotal);
        assertThat(actual.rows().stream().map(ContentItemRecord::id).toList())
                .as("query=%s type=%s page=%s", query, type, page).containsExactlyElementsOf(oldIds);
    }
}
