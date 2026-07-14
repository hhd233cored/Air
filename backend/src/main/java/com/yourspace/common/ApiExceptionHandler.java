package com.yourspace.common;

import com.yourspace.article.service.ArticleNotFoundException;
import com.yourspace.article.service.DuplicateSlugException;
import com.yourspace.auth.service.InvalidCredentialsException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(ArticleNotFoundException.class)
    public ResponseEntity<ApiError> notFound(ArticleNotFoundException exception, HttpServletRequest request) {
        return error(HttpStatus.NOT_FOUND, "ARTICLE_NOT_FOUND", exception.getMessage(), request, Map.of());
    }

    @ExceptionHandler(DuplicateSlugException.class)
    public ResponseEntity<ApiError> conflict(DuplicateSlugException exception, HttpServletRequest request) {
        return error(HttpStatus.CONFLICT, "ARTICLE_SLUG_EXISTS", exception.getMessage(), request, Map.of());
    }

    @ExceptionHandler(InvalidCredentialsException.class)
    public ResponseEntity<ApiError> invalidCredentials(InvalidCredentialsException exception, HttpServletRequest request) {
        return error(HttpStatus.UNAUTHORIZED, "AUTH_INVALID_CREDENTIALS", exception.getMessage(), request, Map.of());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> validation(MethodArgumentNotValidException exception, HttpServletRequest request) {
        Map<String, String> details = new LinkedHashMap<>();
        exception.getBindingResult().getFieldErrors().forEach(field -> details.putIfAbsent(field.getField(), field.getDefaultMessage()));
        return error(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Request validation failed", request, details);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiError> typeMismatch(MethodArgumentTypeMismatchException exception, HttpServletRequest request) {
        return error(HttpStatus.BAD_REQUEST, "INVALID_PARAMETER", "Invalid request parameter", request, Map.of());
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
