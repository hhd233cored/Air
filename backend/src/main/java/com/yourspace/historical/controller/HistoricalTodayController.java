package com.yourspace.historical.controller;

import com.yourspace.historical.dto.HistoricalTodayResponse;
import com.yourspace.historical.service.WikipediaOnThisDayService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/historical-today")
public class HistoricalTodayController {
    private final WikipediaOnThisDayService service;

    public HistoricalTodayController(WikipediaOnThisDayService service) {
        this.service = service;
    }

    @GetMapping
    public HistoricalTodayResponse getToday() {
        return service.getToday();
    }
}
