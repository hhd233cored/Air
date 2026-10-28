package org.airchord.backend.metrics;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.DoubleSupplier;
import org.springframework.beans.factory.annotation.Autowired;

/** 压测专用：从最早的 Servlet 过滤器开始记录请求进入服务后的等待与过滤器耗时。 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
@ConditionalOnProperty(name = "airchord.perf-timing-enabled", havingValue = "true")
public class ArticleMetricPerfRequestFilter extends OncePerRequestFilter {
    private final boolean jdbcTiming;
    private final double sampleRate;
    private final DoubleSupplier random;
    @Autowired
    public ArticleMetricPerfRequestFilter(@Value("${airchord.perf-jdbc-enabled:false}") boolean jdbcTiming,
            @Value("${airchord.perf-jdbc-sample-rate:1.0}") double sampleRate) {
        this(jdbcTiming, sampleRate, () -> ThreadLocalRandom.current().nextDouble());
    }
    ArticleMetricPerfRequestFilter(boolean jdbcTiming, double sampleRate, DoubleSupplier random) {
        if (!Double.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
            throw new IllegalArgumentException("JDBC sample rate must be in [0,1]");
        }
        this.jdbcTiming = jdbcTiming;
        this.sampleRate = sampleRate;
        this.random = random;
    }
    static final String START_NANOS = ArticleMetricPerfRequestFilter.class.getName() + ".startNanos";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String path = request.getRequestURI();
        if ("1".equals(request.getHeader("X-Perf-Timing"))
                && path.startsWith("/api/v1/articles/")
                && (path.endsWith("/views") || path.endsWith("/like"))) {
            long started = System.nanoTime();
            request.setAttribute(START_NANOS, started);
            ArticleMetricTiming.begin(jdbcTiming && (sampleRate == 1 || random.getAsDouble() < sampleRate));
            Object parseStart = request.getAttribute(ArticleMetricPerfTomcatConfiguration.PARSE_START);
            if (parseStart instanceof Long parsed && parsed <= started) {
                ArticleMetricTiming.current().tomcatPreFilter = started - parsed;
            }
            try {
                chain.doFilter(request, response);
            } finally {
                ArticleMetricTiming.clear();
            }
            return;
        }
        chain.doFilter(request, response);
    }
}
