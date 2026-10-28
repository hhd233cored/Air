package org.airchord.backend.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;

/** 为现有浏览器客户端写入可读的 CSRF 镜像 Cookie；服务器端校验值仍保存在 Redis session 中。 */
@Component
public class AuthCookieWriter {

    private final String sessionCookieName;
    private final boolean secure;
    private final String sameSite;
    private final Duration sessionTimeout;

    public AuthCookieWriter(
            @Value("${airchord.auth.cookie-name:air_session}") String sessionCookieName,
            @Value("${airchord.auth.cookie-secure:false}") boolean secure,
            @Value("${airchord.auth.cookie-same-site:Lax}") String sameSite,
            @Value("${airchord.auth.session-timeout:7d}") Duration sessionTimeout
    ) {
        this.sessionCookieName = sessionCookieName;
        this.secure = secure;
        this.sameSite = sameSite;
        this.sessionTimeout = sessionTimeout;
        if ("None".equalsIgnoreCase(sameSite) && !secure) {
            throw new IllegalArgumentException("SameSite=None 的 Cookie 必须同时启用 AUTH_COOKIE_SECURE");
        }
    }

    public void writeCsrfCookie(HttpServletResponse response, String token) {
        ResponseCookie cookie = ResponseCookie.from("XSRF-TOKEN", token)
                .httpOnly(false)
                .secure(secure)
                .sameSite(sameSite)
                .path("/")
                .maxAge(sessionTimeout)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }

    public void clearCsrfCookie(HttpServletResponse response) {
        addExpiredCookie(response, "XSRF-TOKEN", false);
    }

    public void clearSessionCookie(HttpServletResponse response) {
        addExpiredCookie(response, sessionCookieName, true);
    }

    private void addExpiredCookie(HttpServletResponse response, String name, boolean httpOnly) {
        ResponseCookie cookie = ResponseCookie.from(name, "")
                .httpOnly(httpOnly)
                .secure(secure)
                .sameSite(sameSite)
                .path("/")
                .maxAge(Duration.ZERO)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
