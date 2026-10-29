package org.airchord.backend.historical;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Pattern;

import org.airchord.backend.historical.HistoricalTodayDtos.Event;
import org.airchord.backend.historical.HistoricalTodayDtos.Part;
import org.airchord.backend.historical.HistoricalTodayDtos.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.util.HtmlUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 与 Python 后端共用 Wikimedia On This Day feed 和前端响应契约。 */
@Service
public class HistoricalTodayService {
    private static final Logger LOGGER = LoggerFactory.getLogger(HistoricalTodayService.class);
    private static final List<String> CATEGORIES = List.of("selected", "events", "births", "deaths", "holidays");
    private static final Pattern TAGS = Pattern.compile("<[^>]*>");
    private static final Pattern EMPTY_BOOK_TITLE = Pattern.compile("《\\s*(?:\\[\\s*\\])?\\s*》");
    private static final int MAX_EVENTS = 5;

    private final String endpointBaseUrl;
    private final ZoneId zone;
    private final HttpClient http;
    private final JsonMapper json = JsonMapper.builder().build();
    private CacheEntry cache;

    public HistoricalTodayService(
            @Value("${airchord.wikipedia.on-this-day-url}") String endpointBaseUrl,
            @Value("${airchord.wikipedia.time-zone}") String timeZone
    ) {
        this.endpointBaseUrl = endpointBaseUrl.replaceAll("/+$", "");
        this.zone = ZoneId.of(timeZone);
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    public synchronized Response getToday() {
        ZonedDateTime now = ZonedDateTime.now(zone);
        LocalDate today = now.toLocalDate();
        if (cache != null && cache.date.equals(today) && now.isBefore(cache.expiresAt)) {
            return cache.response;
        }

        Response response = fetch(today);
        // A temporary upstream failure should not be retained for the rest of the hour.
        ZonedDateTime expiresAt = response.available()
                ? now.truncatedTo(ChronoUnit.HOURS).plusHours(1)
                : now.plusMinutes(1);
        cache = new CacheEntry(today, expiresAt, response);
        return response;
    }

    private Response fetch(LocalDate today) {
        try {
            String endpoint = "%s/%02d/%02d".formatted(endpointBaseUrl, today.getMonthValue(), today.getDayOfMonth());
            HttpRequest request = HttpRequest.newBuilder(URI.create(endpoint))
                    .timeout(Duration.ofSeconds(20))
                    .header("Accept", "application/json")
                    .header("User-Agent", "Air-personal-site/1.0 (local development)")
                    .GET()
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                JsonNode root = json.readTree(response.body());
                if (root != null && root.isObject()) {
                    return new Response(today, Instant.now(), true, parseEvents(root));
                }
            }
            LOGGER.warn("Wikimedia On This Day returned HTTP {}", response.statusCode());
        } catch (Exception exception) {
            LOGGER.warn("Could not fetch Wikimedia On This Day data: {}", exception.toString());
        }
        return new Response(today, Instant.now(), false, List.of());
    }

    static List<Event> parseEvents(JsonNode root) {
        List<Event> events = new ArrayList<>();
        for (String category : CATEGORIES) {
            JsonNode items = root.path(category);
            if (!items.isArray()) continue;
            for (JsonNode item : items) {
                if (!item.isObject() || !item.path("text").isTextual()) continue;
                String text = cleanText(item.path("text").asText());
                if (text.isBlank()) continue;
                JsonNode yearNode = item.path("year");
                Integer year = yearNode.isIntegralNumber() ? yearNode.intValue() : null;
                events.add(new Event(year, text, linkedParts(text, item), null));
                if (events.size() == MAX_EVENTS) return List.copyOf(events);
            }
        }
        return List.copyOf(events);
    }

    private static String cleanText(String value) {
        String text = TAGS.matcher(HtmlUtils.htmlUnescape(value)).replaceAll("");
        text = EMPTY_BOOK_TITLE.matcher(text).replaceAll("");
        return text.replaceAll("\\s+", " ").trim();
    }

    private static List<Part> linkedParts(String text, JsonNode item) {
        JsonNode pages = item.path("pages");
        if (!pages.isArray()) return List.of(new Part(text, null));
        List<LinkMatch> matches = new ArrayList<>();
        for (JsonNode page : pages) {
            if (!page.isObject()) continue;
            JsonNode titles = page.path("titles");
            String title = "";
            for (String key : List.of("display", "normalized", "canonical")) {
                if (titles.path(key).isTextual()) {
                    title = cleanText(titles.path(key).asText()).replace('_', ' ');
                    if (!title.isBlank()) break;
                }
            }
            if (title.isBlank()) {
                for (String key : List.of("displaytitle", "title")) {
                    if (page.path(key).isTextual()) {
                        title = cleanText(page.path(key).asText()).replace('_', ' ');
                        if (!title.isBlank()) break;
                    }
                }
            }
            String href = page.path("content_urls").path("desktop").path("page").asText("");
            if (title.isBlank() || title.matches("\\d{4}年?") || !isHttpUrl(href)) continue;
            int start = text.indexOf(title);
            while (start >= 0) {
                int end = start + title.length();
                boolean overlaps = false;
                for (LinkMatch match : matches) {
                    if (start < match.end && end > match.start) {
                        overlaps = true;
                        break;
                    }
                }
                if (!overlaps) {
                    matches.add(new LinkMatch(start, end, href));
                    break;
                }
                start = text.indexOf(title, start + 1);
            }
        }
        if (matches.isEmpty()) return List.of(new Part(text, null));
        matches.sort(Comparator.comparingInt(LinkMatch::start));
        List<Part> parts = new ArrayList<>();
        int cursor = 0;
        for (LinkMatch match : matches) {
            if (cursor < match.start) parts.add(new Part(text.substring(cursor, match.start), null));
            parts.add(new Part(text.substring(match.start, match.end), match.href));
            cursor = match.end;
        }
        if (cursor < text.length()) parts.add(new Part(text.substring(cursor), null));
        return List.copyOf(parts);
    }

    private static boolean isHttpUrl(String value) {
        try {
            String scheme = URI.create(value).getScheme();
            return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private record LinkMatch(int start, int end, String href) {}
    private record CacheEntry(LocalDate date, ZonedDateTime expiresAt, Response response) {}
}
