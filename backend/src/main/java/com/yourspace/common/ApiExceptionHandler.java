package com.yourspace.common;

import com.yourspace.article.service.ArticleNotFoundException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;
import java.util.Map;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(ArticleNotFoundException.class)
    public ResponseEntity<ApiError> notFound(ArticleNotFoundException exception, HttpServletRequest request) {
        return error(HttpStatus.NOT_FOUND, "ARTICLE_NOT_FOUND", exception.getMessage(), request, Map.of());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiError> badRequest(IllegalArgumentException exception, HttpServletRequest request) {
        return error(HttpStatus.BAD_REQUEST, "BAD_REQUEST", exception.getMessage(), request, Map.of());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> unexpected(Exception exception, HttpServletRequest request) {
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Unexpected server error", request, Map.of());
    }

    private ResponseEntity<ApiError> error(HttpStatus status, String code, String message, HttpServletRequest request, Map<String, String> details) {
        return ResponseEntity.status(status).body(new ApiError(code, message, Instant.now(), request.getRequestURI(), details));
    }
}
