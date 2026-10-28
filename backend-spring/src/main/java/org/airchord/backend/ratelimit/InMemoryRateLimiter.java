package org.airchord.backend.ratelimit;

import org.airchord.backend.auth.AuthPrincipal;
import org.airchord.backend.web.BackendApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.net.InetAddress;
import java.util.Arrays;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * 单进程滑动窗口限流，规则默认与 Python 服务一致。
 * 该实现用于当前单容器学习环境；多副本部署时应改为 Redis 原子计数。
 */
@Component
public class InMemoryRateLimiter implements HandlerInterceptor, WebMvcConfigurer {
    private final SlidingWindowBuckets buckets;
    private final boolean enabled;
    private final boolean trustProxyHeaders;
    private final Set<String> trustedProxyIps;
    private final int loginIpMax, loginIpSeconds, loginUserMax, loginUserSeconds;
    private final int registerMax, registerSeconds, commentIpMax, commentIpSeconds, commentUserMax, commentUserSeconds;
    private final int guestbookIpMax, guestbookIpSeconds, guestbookUserMax, guestbookUserSeconds;
    private final int avatarUserMax, avatarUserSeconds, adminMax, adminSeconds, csrfMax, csrfSeconds;
    private final int articleViewIpMax, articleViewIpSeconds, articleLikeIpMax, articleLikeIpSeconds;
    private final int articleLikeUserMax, articleLikeUserSeconds;

    public InMemoryRateLimiter(
            @Value("${airchord.rate-limit.enabled:true}") boolean enabled,
            @Value("${airchord.rate-limit.max-keys:10000}") int maxKeys,
            @Value("${airchord.rate-limit.trust-proxy-headers:false}") boolean trustProxyHeaders,
            @Value("${airchord.rate-limit.trusted-proxy-ips:127.0.0.1}") String trustedProxyIps,
            @Value("${airchord.rate-limit.login-ip-max:5}") int loginIpMax,
            @Value("${airchord.rate-limit.login-ip-seconds:60}") int loginIpSeconds,
            @Value("${airchord.rate-limit.login-user-max:10}") int loginUserMax,
            @Value("${airchord.rate-limit.login-user-seconds:600}") int loginUserSeconds,
            @Value("${airchord.rate-limit.register-max:3}") int registerMax,
            @Value("${airchord.rate-limit.register-seconds:3600}") int registerSeconds,
            @Value("${airchord.rate-limit.comment-ip-max:20}") int commentIpMax,
            @Value("${airchord.rate-limit.comment-ip-seconds:60}") int commentIpSeconds,
            @Value("${airchord.rate-limit.comment-user-max:10}") int commentUserMax,
            @Value("${airchord.rate-limit.comment-user-seconds:60}") int commentUserSeconds,
            @Value("${airchord.rate-limit.guestbook-ip-max:10}") int guestbookIpMax,
            @Value("${airchord.rate-limit.guestbook-ip-seconds:3600}") int guestbookIpSeconds,
            @Value("${airchord.rate-limit.guestbook-user-max:3}") int guestbookUserMax,
            @Value("${airchord.rate-limit.guestbook-user-seconds:3600}") int guestbookUserSeconds,
            @Value("${airchord.rate-limit.avatar-user-max:5}") int avatarUserMax,
            @Value("${airchord.rate-limit.avatar-user-seconds:3600}") int avatarUserSeconds,
            @Value("${airchord.rate-limit.admin-max:60}") int adminMax,
            @Value("${airchord.rate-limit.admin-seconds:60}") int adminSeconds,
            @Value("${airchord.rate-limit.csrf-max:30}") int csrfMax,
            @Value("${airchord.rate-limit.csrf-seconds:60}") int csrfSeconds,
            @Value("${airchord.rate-limit.article-view-ip-max:120}") int articleViewIpMax,
            @Value("${airchord.rate-limit.article-view-ip-seconds:60}") int articleViewIpSeconds,
            @Value("${airchord.rate-limit.article-like-ip-max:300}") int articleLikeIpMax,
            @Value("${airchord.rate-limit.article-like-ip-seconds:60}") int articleLikeIpSeconds,
            @Value("${airchord.rate-limit.article-like-user-max:30}") int articleLikeUserMax,
            @Value("${airchord.rate-limit.article-like-user-seconds:60}") int articleLikeUserSeconds
    ) {
        this.enabled = enabled; this.buckets = new SlidingWindowBuckets(Math.max(100, maxKeys), System::nanoTime);
        this.trustProxyHeaders = trustProxyHeaders;
        this.trustedProxyIps = Arrays.stream(trustedProxyIps.split(","))
                .map(String::strip).map(InMemoryRateLimiter::normalizeIp).filter(Objects::nonNull)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
        this.loginIpMax = loginIpMax; this.loginIpSeconds = loginIpSeconds;
        this.loginUserMax = loginUserMax; this.loginUserSeconds = loginUserSeconds;
        this.registerMax = registerMax; this.registerSeconds = registerSeconds;
        this.commentIpMax = commentIpMax; this.commentIpSeconds = commentIpSeconds;
        this.commentUserMax = commentUserMax; this.commentUserSeconds = commentUserSeconds;
        this.guestbookIpMax = guestbookIpMax; this.guestbookIpSeconds = guestbookIpSeconds;
        this.guestbookUserMax = guestbookUserMax; this.guestbookUserSeconds = guestbookUserSeconds;
        this.avatarUserMax = avatarUserMax; this.avatarUserSeconds = avatarUserSeconds;
        this.adminMax = adminMax; this.adminSeconds = adminSeconds; this.csrfMax = csrfMax; this.csrfSeconds = csrfSeconds;
        this.articleViewIpMax = articleViewIpMax; this.articleViewIpSeconds = articleViewIpSeconds;
        this.articleLikeIpMax = articleLikeIpMax; this.articleLikeIpSeconds = articleLikeIpSeconds;
        this.articleLikeUserMax = articleLikeUserMax; this.articleLikeUserSeconds = articleLikeUserSeconds;
    }

    @Override public void addInterceptors(InterceptorRegistry registry) { registry.addInterceptor(this).addPathPatterns("/api/v1/**"); }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String path = request.getRequestURI();
        String method = request.getMethod();
        String ip = clientIp(request);
        AuthPrincipal principal = org.springframework.security.core.context.SecurityContextHolder.getContext()
                .getAuthentication() == null ? null :
                org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication().getPrincipal() instanceof AuthPrincipal p ? p : null;
        if ("GET".equals(method) && path.equals("/api/v1/auth/csrf")) {
            check("csrf-ip", ip, csrfMax, csrfSeconds, response);
        } else if ("POST".equals(method) && path.equals("/api/v1/auth/login")) {
            check("login-ip", ip, loginIpMax, loginIpSeconds, response);
        } else if ("POST".equals(method) && path.equals("/api/v1/auth/register")) {
            check("register-ip", ip, registerMax, registerSeconds, response);
        } else if (("POST".equals(method) && path.matches("/api/v1/(articles|chatter)/[^/]+/comments"))
                || ("DELETE".equals(method) && path.matches("/api/v1/comments/\\d+"))) {
            check("comment-ip", ip, commentIpMax, commentIpSeconds, response);
            if (principal != null) check("comment-user", Long.toString(principal.id()), commentUserMax, commentUserSeconds, response);
        } else if (("POST".equals(method) && path.equals("/api/v1/guestbook/messages"))
                || ("DELETE".equals(method) && path.matches("/api/v1/guestbook/messages/\\d+"))) {
            check("guestbook-ip", ip, guestbookIpMax, guestbookIpSeconds, response);
            if (principal != null) check("guestbook-user", Long.toString(principal.id()), guestbookUserMax, guestbookUserSeconds, response);
        } else if (path.equals("/api/v1/auth/me/avatar") && ("PUT".equals(method) || "DELETE".equals(method))) {
            if (principal != null) check("avatar-user", Long.toString(principal.id()), avatarUserMax, avatarUserSeconds, response);
        } else if ("POST".equals(method) && path.matches("/api/v1/articles/[^/]+/views")) {
            check("article-view-ip", ip, articleViewIpMax, articleViewIpSeconds, response);
        } else if (("PUT".equals(method) || "DELETE".equals(method))
                && path.matches("/api/v1/articles/[^/]+/like")) {
            check("article-like-ip", ip, articleLikeIpMax, articleLikeIpSeconds, response);
            if (principal != null) check("article-like-user", Long.toString(principal.id()),
                    articleLikeUserMax, articleLikeUserSeconds, response);
        } else if ((path.startsWith("/api/v1/admin/") || path.startsWith("/api/v1/editor/")) && !"GET".equals(method)) {
            check("admin-ip", ip, adminMax, adminSeconds, response);
            if (principal != null) check("admin-user", Long.toString(principal.id()), adminMax, adminSeconds, response);
        }
        return true;
    }

    /** 登录用户名独立计数，降低同一账号被轮番猜密码的风险。 */
    public void checkLoginUsername(String username, HttpServletResponse response) {
        check("login-username", username.strip().toLowerCase(Locale.ROOT), loginUserMax, loginUserSeconds, response);
    }

    private void check(String scope, String identifier, int limit, int seconds, HttpServletResponse response) {
        if (!enabled || limit <= 0 || seconds <= 0) return;
        long window = seconds * 1_000_000_000L;
        String key = scope + ":" + identifier;
        SlidingWindowBuckets.Result result = buckets.check(key, limit, window);
        response.setHeader("X-RateLimit-Limit", Integer.toString(limit));
        response.setHeader("X-RateLimit-Remaining", Integer.toString(result.remaining()));
        response.setHeader("X-RateLimit-Reset", Long.toString(result.resetSeconds()));
        if (result.limited()) {
            response.setHeader("Retry-After", Long.toString(result.resetSeconds()));
            throw new BackendApiException("RATE_LIMITED", "请求过于频繁，请稍后再试", 429);
        }
    }

    /** 无新请求时也释放过期桶；有请求时按到期顺序惰性清理。 */
    @Scheduled(fixedDelay = 60_000)
    public void cleanUp() { buckets.cleanUp(); }

    private String clientIp(HttpServletRequest request) {
        String peer = request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr();
        String normalizedPeer = normalizeIp(peer);
        if (trustProxyHeaders && normalizedPeer != null && trustedProxyIps.contains(normalizedPeer)) {
            String cloudflare = request.getHeader("CF-Connecting-IP");
            String forwarded = request.getHeader("X-Forwarded-For");
            String candidate = cloudflare == null || cloudflare.isBlank()
                    ? (forwarded == null ? "" : forwarded.split(",", 2)[0].strip()) : cloudflare.strip();
            String normalized = normalizeIp(candidate);
            if (normalized != null) return normalized;
        }
        return normalizedPeer == null ? peer : normalizedPeer;
    }

    private static String normalizeIp(String candidate) {
        try {
            if (candidate.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) {
                String[] parts = candidate.split("\\.");
                for (String part : parts) if (Integer.parseInt(part) > 255) return null;
                return Arrays.stream(parts).map(part -> Integer.toString(Integer.parseInt(part)))
                        .collect(java.util.stream.Collectors.joining("."));
            }
            if (candidate.contains(":")) return InetAddress.getByName(candidate).getHostAddress();
        } catch (Exception ignored) { }
        return null;
    }
}
