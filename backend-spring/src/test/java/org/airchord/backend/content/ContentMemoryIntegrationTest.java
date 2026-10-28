package org.airchord.backend.content;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;
import java.nio.file.*;
import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;

/** 使用测试数据库中的独立随机 schema；不读取已有业务表，也不依赖 Redis。 */
@EnabledIfEnvironmentVariable(named = "AIRCHORD_TEST_JDBC_URL", matches = ".+")
class ContentMemoryIntegrationTest {
    @TempDir Path root;

    @Test
    void backfillProjectionsAndCursorIndexWorkAgainstPostgres() throws Exception {
        String url = System.getenv("AIRCHORD_TEST_JDBC_URL");
        String user = System.getenv("AIRCHORD_TEST_DB_USER");
        String password = System.getenv("AIRCHORD_TEST_DB_PASSWORD");
        var admin = new DriverManagerDataSource(url, user, password);
        var adminJdbc = new JdbcTemplate(admin);
        String schema = "memory_test_" + UUID.randomUUID().toString().replace("-", "");
        adminJdbc.execute("CREATE SCHEMA " + schema);
        try {
            var source = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema, user, password);
            var jdbc = new JdbcTemplate(source);
            Flyway.configure().dataSource(source).defaultSchema(schema)
                    .locations("classpath:db/migration", "classpath:db/fixtures").target("901").load().migrate();
            assertThat(jdbc.queryForObject("SELECT preview FROM content_items WHERE id = 'article-demo'", String.class)).isNull();
            Flyway.configure().dataSource(source).defaultSchema(schema)
                    .locations("classpath:db/migration", "classpath:db/fixtures").load().migrate();
            var repository = new ContentReadRepository(JdbcClient.create(source), jdbc);
            var transaction = new TransactionTemplate(new DataSourceTransactionManager(source));
            var detail = repository.findPublished("ARTICLE", "learning-spring");
            assertThat(detail.preview()).isEqualTo(MarkdownPreview.from(detail.contentMarkdown()));
            assertThat(repository.search("Spring", "ALL", 0, 10).rows())
                    .allSatisfy(row -> { assertThat(row.contentMarkdown()).isNull(); assertThat(row.preview()).isNotNull(); });
            assertThat(repository.listChatter(0, 10, null).rows().getFirst().contentMarkdown()).isNull();
            assertThat(repository.listForEditor("ARTICLE", 0, 10, null).rows().getFirst().contentMarkdown()).isNull();

            // 超过游标批量大小；正文较长，但索引读取只包含预览。
            transaction.executeWithoutResult(status -> {
                for (int i = 0; i < 205; i++) {
                    var row = new ContentItemRecord("CHATTER", "batch-" + i, "batch-" + i,
                            null, null, null, null, List.of(), "PUBLISHED", "2026-09-01T00:00:00Z",
                            "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z", "正文".repeat(2000));
                    repository.insertEditor(row, MarkdownPreview.from(row.contentMarkdown()), null);
                }
            });
            var editor = new ContentEditorService(repository, event -> { }, root.resolve("articles").toString(),
                    root.resolve("chatter").toString(), true, 1024);
            // 在真实提交回调中写索引，验证游标及连接生命周期。
            transaction.executeWithoutResult(status -> editor.updateChatter("batch-0", null, null, null,
                    "新的 **摘要**", List.of()));
            var index = JsonMapper.builder().build().readTree(root.resolve("chatter/index.json").toFile());
            assertThat(index.size()).isEqualTo(206); // 205 个新增条目和一个公开夹具，不包含草稿。
            assertThat(repository.findPublished("CHATTER", "batch-0").preview()).isEqualTo("新的 摘要");
            assertThat(index.get(0).path("slug").asText()).isEqualTo("small-note");
            for (var entry : index) assertThat(entry.has("contentMarkdown")).isFalse();
        } finally {
            adminJdbc.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }
}
