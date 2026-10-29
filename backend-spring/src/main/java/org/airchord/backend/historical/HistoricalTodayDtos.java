package org.airchord.backend.historical;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public final class HistoricalTodayDtos {
    private HistoricalTodayDtos() {}

    public record Part(String text, String href) {}

    public record Event(Integer year, String text, List<Part> parts, String yearHref) {}

    public record Response(LocalDate date, Instant fetchedAt, boolean available, List<Event> events) {}
}
