package org.airchord.backend.metrics;

import jakarta.servlet.http.HttpServletRequest;
import org.airchord.backend.auth.AuthPrincipal;
import org.airchord.backend.metrics.ArticleMetricService.LikeResponse;
import org.airchord.backend.metrics.ArticleMetricService.StatsResponse;
import org.airchord.backend.metrics.ArticleMetricService.ViewResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.function.Supplier;

/** 浏览事件与点赞关系走独立 API，不让计数更新使整篇文章详情缓存失效。 */
@RestController
@RequestMapping("/api/v1/articles/{slug}")
public class ArticleMetricController {
    private final ArticleMetricService service;
    private final boolean perfTimingEnabled;

    public ArticleMetricController(ArticleMetricService service,
                                   @Value("${airchord.perf-timing-enabled:false}") boolean perfTimingEnabled) {
        this.service = service;
        this.perfTimingEnabled = perfTimingEnabled;
    }

    @GetMapping("/stats")
    public StatsResponse stats(@PathVariable String slug, @AuthenticationPrincipal AuthPrincipal actor) {
        return service.stats(slug, actor);
    }

    @PostMapping("/views")
    public ResponseEntity<ViewResponse> view(@PathVariable String slug,
                                              @RequestHeader(value = "Idempotency-Key", required = false) String eventId,
                                              @RequestHeader(value = "X-Perf-Timing", required = false) String perfTiming,
                                              @AuthenticationPrincipal AuthPrincipal actor,
                                              HttpServletRequest request) {
        return write(202, perfTiming, request, () -> service.view(slug, eventId, actor));
    }

    @PutMapping("/like")
    public ResponseEntity<LikeResponse> like(@PathVariable String slug,
                                              @RequestHeader(value = "X-Perf-Timing", required = false) String perfTiming,
                                              @AuthenticationPrincipal AuthPrincipal actor,
                                              HttpServletRequest request) {
        return write(200, perfTiming, request, () -> service.like(slug, actor));
    }

    @DeleteMapping("/like")
    public ResponseEntity<LikeResponse> unlike(@PathVariable String slug,
                                                @RequestHeader(value = "X-Perf-Timing", required = false) String perfTiming,
                                                @AuthenticationPrincipal AuthPrincipal actor,
                                                HttpServletRequest request) {
        return write(200, perfTiming, request, () -> service.unlike(slug, actor));
    }

    private <T> ResponseEntity<T> write(int status, String requested, HttpServletRequest request, Supplier<T> action) {
        if (!perfTimingEnabled || !"1".equals(requested)) return ResponseEntity.status(status).body(action.get());
        // 只在独立压测栈开启；Server-Timing 不改变正文和原有状态码。
        Object requestStart = request.getAttribute(ArticleMetricPerfRequestFilter.START_NANOS);
        long preControllerNanos = requestStart instanceof Long started ? System.nanoTime() - started : 0;
        long preControllerAcquireNanos = ArticleMetricTiming.connectionAcquireNanos();
        long controllerStart = System.nanoTime();
        T body = action.get();
        var response = ResponseEntity.status(status)
                .header("Server-Timing", ArticleMetricTiming.serverTiming(preControllerNanos,
                        System.nanoTime() - controllerStart, preControllerAcquireNanos));
        String counts = ArticleMetricTiming.countsHeader();
        if (counts != null) response.header("X-Perf-Db-Counts", counts);
        return response.body(body);
    }
}
