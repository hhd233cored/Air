package org.airchord.backend.metrics;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import static org.assertj.core.api.Assertions.*;

class ArticleMetricPerfRequestFilterTest {
    @Test void tomcatParsingDurationIsAvailableWithoutJdbcSampling() throws Exception {
        var request = new MockHttpServletRequest("POST", "/api/v1/articles/example/views");
        request.addHeader("X-Perf-Timing", "1");
        request.setAttribute(ArticleMetricPerfTomcatConfiguration.PARSE_START, System.nanoTime()-1_000_000);
        new ArticleMetricPerfRequestFilter(false,1).doFilter(request, new MockHttpServletResponse(), (req,res)->{
            assertThat(ArticleMetricTiming.current().tomcatPreFilter).isPositive();
            assertThat(ArticleMetricTiming.serverTiming(0,0,0)).contains("tomcatPreFilter;dur=");
            assertThat(ArticleMetricTiming.countsHeader()).isNull();
        });
        assertThat(ArticleMetricTiming.current()).isNull();
    }
    @Test void samplingKeepsBaseTimingAndClearsBothSelectedAndUnselectedRequests() throws Exception {
        for (double draw : new double[]{0.05, 0.5}) {
            var filter = new ArticleMetricPerfRequestFilter(true, 0.1, () -> draw);
            var request = new MockHttpServletRequest("POST", "/api/v1/articles/example/views");
            request.addHeader("X-Perf-Timing", "1");
            filter.doFilter(request, new MockHttpServletResponse(), (req, res) -> {
                assertThat(ArticleMetricTiming.current()).isNotNull();
                assertThat(ArticleMetricTiming.current().jdbcEnabled).isEqualTo(draw < 0.1);
                assertThat(request.getAttribute(ArticleMetricPerfRequestFilter.START_NANOS)).isNotNull();
            });
            assertThat(ArticleMetricTiming.current()).isNull();
        }
    }

    @Test void disabledFullAndExceptionalRequestsHaveCorrectLifecycle() throws Exception {
        for (boolean enabled : new boolean[]{false, true}) {
            var filter = new ArticleMetricPerfRequestFilter(enabled, 1, () -> { throw new AssertionError(); });
            var request = new MockHttpServletRequest("PUT", "/api/v1/articles/example/like");
            request.addHeader("X-Perf-Timing", "1");
            assertThatThrownBy(() -> filter.doFilter(request, new MockHttpServletResponse(), (req, res) -> {
                assertThat(ArticleMetricTiming.current().jdbcEnabled).isEqualTo(enabled);
                throw new java.io.IOException("expected");
            })).isInstanceOf(java.io.IOException.class);
            assertThat(ArticleMetricTiming.current()).isNull();
        }
    }

    @Test void ordinaryRequestsAreUntimedAndInvalidRatesAreRejected() throws Exception {
        var filter = new ArticleMetricPerfRequestFilter(true, 1);
        filter.doFilter(new MockHttpServletRequest("GET", "/api/v1/health"), new MockHttpServletResponse(),
            (req, res) -> assertThat(ArticleMetricTiming.current()).isNull());
        for (double rate : new double[]{-0.1, 1.1, Double.NaN}) {
            assertThatThrownBy(() -> new ArticleMetricPerfRequestFilter(true, rate))
                .isInstanceOf(IllegalArgumentException.class);
        }
    }
}
