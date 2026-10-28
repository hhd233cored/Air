package org.airchord.backend.auth;

/** 业务层认证错误携带稳定错误码与 HTTP 状态，由统一异常处理器转换为 JSON。 */
public class AuthException extends RuntimeException {

    private final String code;
    private final int statusCode;

    public AuthException(String code, String message, int statusCode) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
    }

    public String code() {
        return code;
    }

    public int statusCode() {
        return statusCode;
    }
}
