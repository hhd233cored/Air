package org.airchord.backend;

import org.airchord.backend.ratelimit.InMemoryRateLimiter;
import org.airchord.backend.web.BackendApiException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 不依赖数据库的滑动窗口限流测试。 */
class RateLimitUnitTest {
    @Test
    void loginUsernameBucketReturns429HeadersAfterConfiguredLimit() {
        InMemoryRateLimiter limiter = limiter(5, 1, false);
        MockHttpServletResponse response = new MockHttpServletResponse();
        limiter.checkLoginUsername("reader", response);

        assertThatThrownBy(() -> limiter.checkLoginUsername("reader", response))
                .isInstanceOf(BackendApiException.class)
                .hasMessage("请求过于频繁，请稍后再试")
                .extracting("statusCode").isEqualTo(429);
        assertThat(response.getHeader("Retry-After")).isNotBlank();
        assertThat(response.getHeader("X-RateLimit-Limit")).isEqualTo("1");
        assertThat(response.getHeader("X-RateLimit-Remaining")).isEqualTo("0");
    }

    @Test
    void forwardedAddressIsIgnoredUnlessThePeerIsAConfiguredTrustedProxy() {
        InMemoryRateLimiter limiter = limiter(1, 10, false);
        MockHttpServletRequest first = loginRequest("198.51.100.1");
        MockHttpServletRequest second = loginRequest("203.0.113.9");
        limiter.preHandle(first, new MockHttpServletResponse(), new Object());

        assertThatThrownBy(() -> limiter.preHandle(second, new MockHttpServletResponse(), new Object()))
                .isInstanceOf(BackendApiException.class)
                .satisfies(error -> org.assertj.core.api.Assertions.assertThat(((BackendApiException) error).statusCode()).isEqualTo(429));
    }

    private static MockHttpServletRequest loginRequest(String forwardedFor) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("192.0.2.10");
        request.setMethod("POST");
        request.setRequestURI("/api/v1/auth/login");
        request.addHeader("X-Forwarded-For", forwardedFor);
        return request;
    }

    private static InMemoryRateLimiter limiter(int loginIpMax, int loginUserMax, boolean trustProxyHeaders) {
        return new InMemoryRateLimiter(true, 100, trustProxyHeaders, "127.0.0.1",
                loginIpMax, 60, loginUserMax, 600, 3, 3600, 20, 60, 10, 60,
                10, 3600, 3, 3600, 5, 3600, 60, 60, 30, 60,
                120, 60, 300, 60, 30, 60);
    }
}
