package com.yourspace.historical.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.yourspace.historical.dto.HistoricalTodayEvent;
import com.yourspace.historical.dto.HistoricalTodayResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

@Service
public class WikipediaOnThisDayService {
    private static final List<String> CATEGORIES = List.of("selected", "events", "births", "deaths", "holidays");
    private static final int MAX_EVENTS = 5;

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final String endpointBaseUrl;
    private final Clock clock;
    private volatile CachedResponse cache;

    public WikipediaOnThisDayService(
            ObjectMapper objectMapper,
            @Value("${app.wikipedia.on-this-day-url:https://api.wikimedia.org/feed/v1/wikipedia/zh/onthisday/all}") String endpointBaseUrl
    ) {
        this.objectMapper = objectMapper;
        this.endpointBaseUrl = endpointBaseUrl.replaceAll("/$", "");
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(15))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
        this.clock = Clock.systemDefaultZone();
    }

    public HistoricalTodayResponse getToday() {
        ZonedDateTime now = ZonedDateTime.now(clock);
        LocalDate today = now.toLocalDate();
        Instant hour = now.truncatedTo(ChronoUnit.HOURS).toInstant();
        CachedResponse current = cache;
        if (isFresh(current, today, hour)) return current.response();

        synchronized (this) {
            current = cache;
            if (isFresh(current, today, hour)) return current.response();
            return fetchAndCache(today, hour);
        }
    }

    @Scheduled(cron = "0 0 * * * *")
    public void refreshOnTheHour() {
        getToday();
    }

    private boolean isFresh(CachedResponse current, LocalDate today, Instant hour) {
        return current != null && current.date().equals(today) && current.hour().equals(hour);
    }

    private HistoricalTodayResponse fetchAndCache(LocalDate today, Instant hour) {
        List<HistoricalTodayEvent> events = new ArrayList<>();
        boolean available = false;
        try {
            String month = String.format("%02d", today.getMonthValue());
            String day = String.format("%02d", today.getDayOfMonth());
            URI endpoint = URI.create(endpointBaseUrl + "/" + month + "/" + day);
            HttpRequest request = HttpRequest.newBuilder(endpoint)
                    .timeout(Duration.ofSeconds(20))
                    .header("Accept", "application/json")
                    .header("User-Agent", "Air-personal-site/1.0 (local development)")
                    .GET()
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                events.addAll(parseEvents(objectMapper.readTree(response.body())));
                available = true;
            }
        } catch (Exception ignored) {
            // Keep today's cache empty when Wikimedia is temporarily unavailable.
            // Never serve a previous day's data as today's history.
        }

        HistoricalTodayResponse result = new HistoricalTodayResponse(today, Instant.now(clock), available, List.copyOf(events));
        cache = new CachedResponse(today, hour, result);
        return result;
    }

    private List<HistoricalTodayEvent> parseEvents(JsonNode root) {
        List<HistoricalTodayEvent> events = new ArrayList<>();
        for (String category : CATEGORIES) {
            JsonNode categoryItems = root.path(category);
            if (!categoryItems.isArray()) continue;
            for (JsonNode item : categoryItems) {
                String text = textValue(item, "text");
                if (text == null || text.isBlank()) continue;
                Integer year = item.has("year") && item.get("year").canConvertToInt() ? item.get("year").intValue() : null;
                events.add(new HistoricalTodayEvent(year, text));
                if (events.size() >= MAX_EVENTS) return events;
            }
        }
        return events;
    }

    private String textValue(JsonNode node, String field) {
        String value = node.path(field).asText(null);
        return value == null || value.isBlank() ? null : value;
    }

    private record CachedResponse(LocalDate date, Instant hour, HistoricalTodayResponse response) {
    }
}
