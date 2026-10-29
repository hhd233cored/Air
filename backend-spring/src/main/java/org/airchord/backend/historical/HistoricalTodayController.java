package org.airchord.backend.historical;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class HistoricalTodayController {
    private final HistoricalTodayService service;

    public HistoricalTodayController(HistoricalTodayService service) {
        this.service = service;
    }

    @GetMapping("/historical-today")
    public HistoricalTodayDtos.Response today() {
        return service.getToday();
    }
}
