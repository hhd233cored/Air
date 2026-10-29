package org.airchord.backend.historical;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

class HistoricalTodayServiceTest {
    @Test
    void returnsFeedEventsAndCachesSuccessfulHour() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/feed/", exchange -> {
            requests.incrementAndGet();
            exchange.getResponseHeaders().set("Location", "/events");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        server.createContext("/events", exchange -> {
            byte[] body = """
                    {"selected":[{"year":1836,"text":"由拿破仑一世下令兴建的凯旋门落成。","pages":[{"titles":{"display":"凯旋门"},"content_urls":{"desktop":{"page":"https://zh.wikipedia.org/wiki/巴黎凯旋门"}}}]}],
                     "events":[{"year":1911,"text":"另一件事"}]}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            exchange.sendResponseHeaders(200, body.length);
            try (var output = exchange.getResponseBody()) { output.write(body); }
        });
        server.start();
        try {
            var service = new HistoricalTodayService("http://127.0.0.1:" + server.getAddress().getPort() + "/feed", "Asia/Shanghai");
            var first = service.getToday();
            var second = service.getToday();

            assertThat(first.available()).isTrue();
            assertThat(first.date()).isEqualTo(LocalDate.now(ZoneId.of("Asia/Shanghai")));
            assertThat(first.events()).hasSize(2);
            assertThat(first.events().getFirst().year()).isEqualTo(1836);
            assertThat(first.events().getFirst().parts()).anySatisfy(part -> {
                assertThat(part.text()).isEqualTo("凯旋门");
                assertThat(part.href()).isEqualTo("https://zh.wikipedia.org/wiki/巴黎凯旋门");
            });
            assertThat(second).isSameAs(first);
            assertThat(requests).hasValue(1);

            var json = JsonMapper.builder().build().valueToTree(first);
            assertThat(json.path("date").asText()).isNotBlank();
            assertThat(json.path("fetchedAt").asText()).isNotBlank();
            assertThat(json.path("events").get(0).path("parts").isArray()).isTrue();
        } finally {
            server.stop(0);
        }
    }

    @Test
    void unavailableFeedReturnsAStableEmptyResponse() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/feed/", exchange -> {
            exchange.sendResponseHeaders(503, -1);
            exchange.close();
        });
        server.start();
        try {
            var service = new HistoricalTodayService("http://127.0.0.1:" + server.getAddress().getPort() + "/feed", "Asia/Shanghai");
            var response = service.getToday();
            assertThat(response.available()).isFalse();
            assertThat(response.events()).isEmpty();
            assertThat(response.fetchedAt()).isNotNull();
        } finally {
            server.stop(0);
        }
    }
}
