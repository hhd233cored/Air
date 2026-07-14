package com.yourspace.historical.controller;

import com.yourspace.historical.dto.HistoricalTodayResponse;
import com.yourspace.historical.service.WikipediaOnThisDayService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/historical-today")
@Tag(name = "Historical today")
public class HistoricalTodayController {
    private final WikipediaOnThisDayService service;

    public HistoricalTodayController(WikipediaOnThisDayService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "Get today's historical events")
    public HistoricalTodayResponse getToday() {
        return service.getToday();
    }
}
