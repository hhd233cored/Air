package org.airchord.backend.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;

/** 每次认证请求都核对 PostgreSQL 中的账号状态与 Redis session，及时识别禁用账号和角色变更。 */
@Component
public class AuthSessionValidationFilter extends OncePerRequestFilter {

    private final AuthUserRepository users;
    private final Duration absoluteTimeout;
    private final AuthCookieWriter cookieWriter;
    private final ApiSecurityHandlers securityHandlers;

    public AuthSessionValidationFilter(
            AuthUserRepository users,
            @Value("${airchord.auth.session-timeout:7d}") Duration absoluteTimeout,
            AuthCookieWriter cookieWriter,
            ApiSecurityHandlers securityHandlers
    ) {
        this.users = users;
        this.absoluteTimeout = absoluteTimeout;
        this.cookieWriter = cookieWriter;
        this.securityHandlers = securityHandlers;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated()
                && authentication.getPrincipal() instanceof AuthPrincipal principal) {
            HttpSession session = request.getSession(false);
            Object createdAtValue = session == null ? null
                    : session.getAttribute(AuthSessionService.AUTHENTICATED_AT_ATTRIBUTE);
            final AuthUserRecord current;
            try {
                current = users.findById(principal.id());
            } catch (DataAccessException exception) {
                // 无法确认数据库中的账号状态时不放行，也不销毁可能有效的 session。
                SecurityContextHolder.clearContext();
                securityHandlers.serviceUnavailable(request, response);
                return;
            }
            boolean timedOut = !(createdAtValue instanceof Long createdAt)
                    || Instant.now().toEpochMilli() - createdAt >= absoluteTimeout.toMillis();
            boolean accountChanged = current == null || !current.enabled()
                    || !current.role().equals(principal.role())
                    || current.securityVersion() != principal.securityVersion();

            if (timedOut || accountChanged) {
                // 失效 session 继续进入授权阶段，由统一 AuthenticationEntryPoint 返回兼容的 401 JSON。
                SecurityContextHolder.clearContext();
                if (session != null) session.invalidate();
                cookieWriter.clearSessionCookie(response);
                cookieWriter.clearCsrfCookie(response);
            }
        }
        filterChain.doFilter(request, response);
    }
}
