package org.airchord.backend.web;

import java.util.Map;

/** 公开 JSON 错误使用现有 Python API 的固定字段。 */
public record ApiError(
        String code,
        String message,
        String timestamp,
        String path,
        Map<String, Object> details
) {
}
