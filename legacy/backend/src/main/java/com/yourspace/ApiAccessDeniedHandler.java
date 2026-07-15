package com.yourspace.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.csrf.CsrfException;
import org.springframework.security.web.csrf.InvalidCsrfTokenException;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;

@Component
public class ApiAccessDeniedHandler implements AccessDeniedHandler {
    private final ObjectMapper objectMapper;

    public ApiAccessDeniedHandler(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, AccessDeniedException exception) throws IOException, ServletException {
        boolean csrfFailure = exception instanceof CsrfException || exception instanceof InvalidCsrfTokenException;
        String code = csrfFailure ? "CSRF_INVALID" : "AUTH_FORBIDDEN";
        String message = csrfFailure ? "CSRF token is missing or invalid" : "You do not have permission to access this resource";
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        objectMapper.writeValue(response.getOutputStream(), new ApiError(code, message, Instant.now(), request.getRequestURI(), Map.of()));
    }
}
