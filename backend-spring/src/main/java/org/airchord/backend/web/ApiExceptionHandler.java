package org.airchord.backend.web;

import jakarta.servlet.http.HttpServletRequest;
import org.airchord.backend.auth.AuthException;
import org.airchord.backend.music.MusicImportCapacityException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.Map;

/** 把框架异常转成稳定 JSON，避免 Spring 默认错误页泄露给前端。 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger LOGGER = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ContentNotFoundException.class)
    public ResponseEntity<ApiError> contentNotFound(ContentNotFoundException exception, HttpServletRequest request) {
        return error(HttpStatus.NOT_FOUND, exception.code(), exception.getMessage(), request);
    }

    @ExceptionHandler(ApiBadRequestException.class)
    public ResponseEntity<ApiError> invalidParameters(ApiBadRequestException exception, HttpServletRequest request) {
        return error(HttpStatus.BAD_REQUEST, exception.code(), exception.getMessage(), request);
    }

    @ExceptionHandler({
            MethodArgumentTypeMismatchException.class,
            MissingServletRequestParameterException.class,
            MissingServletRequestPartException.class
    })
    public ResponseEntity<ApiError> invalidBinding(Exception exception, HttpServletRequest request) {
        return error(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "Invalid request parameters", request);
    }

    @ExceptionHandler({
            MethodArgumentNotValidException.class,
            HandlerMethodValidationException.class,
            HttpMessageNotReadableException.class
    })
    public ResponseEntity<ApiError> invalidBody(Exception exception, HttpServletRequest request) {
        return error(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "Invalid request parameters", request);
    }

    @ExceptionHandler(AuthException.class)
    public ResponseEntity<ApiError> authError(AuthException exception, HttpServletRequest request) {
        return error(
                HttpStatus.valueOf(exception.statusCode()),
                exception.code(),
                exception.getMessage(),
                request
        );
    }

    @ExceptionHandler(BackendApiException.class)
    public ResponseEntity<ApiError> backendError(BackendApiException exception, HttpServletRequest request) {
        return error(HttpStatus.valueOf(exception.statusCode()), exception.code(), exception.getMessage(), request);
    }

    @ExceptionHandler(MusicImportCapacityException.class)
    public ResponseEntity<ApiError> musicImportBusy(MusicImportCapacityException exception, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .header("Retry-After", "30")
                .body(new ApiError(exception.code(), exception.getMessage(), Instant.now().toString(),
                        request.getRequestURI(), Map.of()));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiError> avatarTooLarge(MaxUploadSizeExceededException exception, HttpServletRequest request) {
        String path = request.getRequestURI();
        if (path.startsWith("/api/v1/editor/"))
            return error(HttpStatus.PAYLOAD_TOO_LARGE, "EDITOR_UPLOAD_TOO_LARGE", "编辑器上传总量不能超过 100 MiB", request);
        if (path.startsWith("/api/v1/admin/music/"))
            return error(HttpStatus.PAYLOAD_TOO_LARGE, "LOCAL_MUSIC_FILE_TOO_LARGE", "音频文件不能超过 50 MiB", request);
        return error(HttpStatus.PAYLOAD_TOO_LARGE, "AUTH_AVATAR_TOO_LARGE", "头像文件过大", request);
    }

    @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class})
    public ResponseEntity<ApiError> resourceNotFound(Exception exception, HttpServletRequest request) {
        return error(HttpStatus.NOT_FOUND, "NOT_FOUND", "Resource not found", request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> unexpected(Exception exception, HttpServletRequest request) {
        // 详细异常保留在服务端日志中，响应不包含 SQL、路径或配置等内部信息。
        LOGGER.error("处理公开请求失败: {} {}", request.getMethod(), request.getRequestURI(), exception);
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Unexpected server error", request);
    }

    private static ResponseEntity<ApiError> error(
            HttpStatus status,
            String code,
            String message,
            HttpServletRequest request
    ) {
        ApiError body = new ApiError(code, message, Instant.now().toString(), request.getRequestURI(), Map.of());
        return ResponseEntity.status(status).body(body);
    }
}
