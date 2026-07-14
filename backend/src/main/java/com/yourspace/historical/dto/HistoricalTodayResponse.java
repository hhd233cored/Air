package com.yourspace.historical.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public record HistoricalTodayResponse(
        LocalDate date,
        Instant fetchedAt,
        boolean available,
        List<HistoricalTodayEvent> events
) {
}
