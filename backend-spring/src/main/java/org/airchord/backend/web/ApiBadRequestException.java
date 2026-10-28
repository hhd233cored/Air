package org.airchord.backend.web;

/** 用于把分页和查询参数校验转换为兼容的 BAD_REQUEST 响应。 */
public class ApiBadRequestException extends RuntimeException {
    private final String code;

    public ApiBadRequestException(String message) {
        this("BAD_REQUEST", message);
    }

    public ApiBadRequestException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
