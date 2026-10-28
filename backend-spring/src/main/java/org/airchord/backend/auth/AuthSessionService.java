package org.airchord.backend.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.stereotype.Service;

import java.time.Instant;

/** 登录成功后轮换 session ID、清除旧 CSRF token，并把 SecurityContext 存入 Redis session。 */
@Service
public class AuthSessionService {

    public static final String AUTHENTICATED_AT_ATTRIBUTE = "airchord.auth.authenticated-at";

    private final SecurityContextRepository securityContextRepository;
    private final CsrfTokenRepository csrfTokenRepository;
    private final AuthCookieWriter cookieWriter;

    public AuthSessionService(
            SecurityContextRepository securityContextRepository,
            CsrfTokenRepository csrfTokenRepository,
            AuthCookieWriter cookieWriter
    ) {
        this.securityContextRepository = securityContextRepository;
        this.csrfTokenRepository = csrfTokenRepository;
        this.cookieWriter = cookieWriter;
    }

    public void establish(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
        // 登录前 CSRF 接口已创建匿名 session；轮换 ID 防止攻击者预先固定 session。
        request.getSession(true);
        request.changeSessionId();
        csrfTokenRepository.saveToken(null, request, response);
        cookieWriter.clearCsrfCookie(response);

        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        securityContextRepository.saveContext(context, request, response);

        // Python 参照实现从创建时间起固定有效 7 天；Redis 的空闲 TTL 之外再检查绝对期限。
        HttpSession session = request.getSession(true);
        session.setAttribute(AUTHENTICATED_AT_ATTRIBUTE, Instant.now().toEpochMilli());
        // Redis 的主体索引支持管理员按用户名查找并撤销此用户的所有登录 session。
        session.setAttribute(FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME,
                authentication.getName());
    }

    public void invalidate(HttpServletRequest request, HttpServletResponse response) {
        SecurityContextHolder.clearContext();
        csrfTokenRepository.saveToken(null, request, response);
        HttpSession session = request.getSession(false);
        if (session != null) session.invalidate();
        cookieWriter.clearCsrfCookie(response);
        cookieWriter.clearSessionCookie(response);
    }
}
