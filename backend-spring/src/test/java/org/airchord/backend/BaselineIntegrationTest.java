package org.airchord.backend;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 使用独立 PostgreSQL 测试库验证应用启动、Flyway 迁移、夹具和 HTTP 契约。
 * 运行前先按 README 启动 Compose 数据库；测试不会访问或修改 Python SQLite 文件。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class BaselineIntegrationTest {

    private static final HttpClient HTTP_CLIENT = HttpClient.newHttpClient();

    @Value("${local.server.port}")
    private int localServerPort;

    @Autowired
    private JdbcClient jdbcClient;

    @Test
    void healthEndpointKeepsTheExistingJsonContract() throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://localhost:" + localServerPort + "/api/v1/health"))
                .GET()
                .build();
        HttpResponse<String> response = HTTP_CLIENT.send(request, HttpResponse.BodyHandlers.ofString());

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).isEqualTo("{\"status\":\"UP\"}");
    }

    @Test
    void flywayCreatesTheReferenceSchemaAndLoadsSyntheticFixtures() {
        assertThat(count("SELECT COUNT(*) FROM users")).isEqualTo(2);
        assertThat(countContent("ARTICLE", "PUBLISHED")).isEqualTo(1);
        assertThat(countContent("ARTICLE", "DRAFT")).isEqualTo(1);
        assertThat(countContent("CHATTER", "PUBLISHED")).isEqualTo(1);
        assertThat(countContent("CHATTER", "DRAFT")).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM comments")).isEqualTo(2);
        assertThat(count("SELECT COUNT(*) FROM guestbook_messages")).isEqualTo(1);
    }

    private long count(String sql) {
        return jdbcClient.sql(sql).query(Long.class).single();
    }

    private long countContent(String contentType, String status) {
        return jdbcClient.sql("""
                        SELECT COUNT(*)
                        FROM content_items
                        WHERE content_type = :contentType AND status = :status
                        """)
                .param("contentType", contentType)
                .param("status", status)
                .query(Long.class)
                .single();
    }
}
