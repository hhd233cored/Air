package org.airchord.backend.web;

/** 业务层使用此异常明确 HTTP 状态与稳定错误码，不把数据库异常直接暴露给客户端。 */
public class BackendApiException extends RuntimeException {

    private final String code;
    private final int statusCode;

    public BackendApiException(String code, String message, int statusCode) {
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
