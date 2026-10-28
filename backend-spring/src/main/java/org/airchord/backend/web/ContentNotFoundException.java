package org.airchord.backend.web;

/** 文章或说说未发布、已删除以及不存在时都按公开 404 处理。 */
public class ContentNotFoundException extends RuntimeException {
    private final String code;

    public ContentNotFoundException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
