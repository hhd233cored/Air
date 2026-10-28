package org.airchord.backend;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.InputStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 检查固定响应样例仍包含前端 DTO 依赖的字段。
 * 这个轻量测试不启动 Spring 或 PostgreSQL，修改样例时可以先单独运行它。
 */
class ContractFixtureTest {

    private final JsonMapper objectMapper = JsonMapper.builder().build();

    @Test
    void articleAndChatterKeepTheExpectedPublicFields() throws Exception {
        JsonNode article = read("article-detail.json");
        assertThat(article.path("id").asText()).isEqualTo("article-demo");
        assertThat(article.path("contentMarkdown").isTextual()).isTrue();
        assertThat(article.path("tags").isArray()).isTrue();
        assertThat(read("articles-page.json").path("totalElements").asInt()).isEqualTo(1);

        JsonNode chatter = read("chatter-detail.json");
        assertThat(chatter.path("slug").asText()).isEqualTo("small-note");
        assertThat(chatter.path("contentMarkdown").isTextual()).isTrue();
        assertThat(chatter.has("coverUrl")).isFalse();
        assertThat(read("chatter-page.json").path("page").asInt()).isZero();
    }

    @Test
    void authAndCommentSamplesKeepTheExpectedNestedFields() throws Exception {
        JsonNode auth = read("auth-me.json").path("user");
        assertThat(auth.path("id").asInt()).isEqualTo(1001);
        assertThat(auth.path("role").asText()).isEqualTo("ADMIN");
        assertThat(auth.has("avatarUrl")).isTrue();

        JsonNode comments = read("comments-page.json");
        assertThat(comments.path("content").size()).isEqualTo(2);
        assertThat(comments.path("content").get(0).path("author").path("username").asText())
                .isEqualTo("demo-reader");
        assertThat(comments.path("content").get(1).path("parentId").asLong()).isEqualTo(2001);

        JsonNode guestbook = read("guestbook-page.json");
        assertThat(guestbook.path("content").get(0).path("targetType").asText()).isEqualTo("GUESTBOOK");
        assertThat(guestbook.path("content").get(0).path("targetId").asText()).isEqualTo("main");

        assertThat(read("health.json").path("status").asText()).isEqualTo("UP");
        JsonNode draftError = read("draft-not-found.json");
        assertThat(draftError.path("code").asText()).isEqualTo("ARTICLE_NOT_FOUND");
        assertThat(draftError.path("message").asText())
                .isEqualTo("Article not found: draft-reference");
    }

    private JsonNode read(String fileName) throws Exception {
        String resourcePath = "/contracts/" + fileName;
        try (InputStream input = getClass().getResourceAsStream(resourcePath)) {
            assertThat(input).as("找不到接口参照文件 %s", resourcePath).isNotNull();
            return objectMapper.readTree(input);
        }
    }
}
