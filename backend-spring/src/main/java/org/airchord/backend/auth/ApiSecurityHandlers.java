package org.airchord.backend.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.airchord.backend.web.ApiError;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.csrf.CsrfException;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;

/** Security filter 发生的 401/403 在 Controller 之前，需在过滤器层写成与 API 一致的 JSON。 */
@Component
public class ApiSecurityHandlers implements AuthenticationEntryPoint, AccessDeniedHandler {

    private final JsonMapper jsonMapper;

    public ApiSecurityHandlers(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    @Override
    public void commence(
            HttpServletRequest request,
            HttpServletResponse response,
            AuthenticationException exception
    ) throws IOException {
        write(response, 401, "AUTH_REQUIRED", "请先登录", request);
    }

    @Override
    public void handle(
            HttpServletRequest request,
            HttpServletResponse response,
            AccessDeniedException exception
    ) throws IOException {
        if (exception instanceof CsrfException) {
            write(response, 403, "CSRF_INVALID", "安全令牌无效或已缺失", request);
        } else {
            write(response, 403, "AUTH_FORBIDDEN", "当前账号没有执行此操作的权限", request);
        }
    }

    public void serviceUnavailable(HttpServletRequest request, HttpServletResponse response) throws IOException {
        write(response, 503, "AUTH_UNAVAILABLE", "认证服务暂时不可用", request);
    }

    private void write(
            HttpServletResponse response,
            int status,
            String code,
            String message,
            HttpServletRequest request
    ) throws IOException {
        if (response.isCommitted()) return;
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        ApiError body = new ApiError(code, message, Instant.now().toString(), request.getRequestURI(), Map.of());
        jsonMapper.writeValue(response.getOutputStream(), body);
    }
}
