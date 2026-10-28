package org.airchord.backend.auth;

/** 用户头像二进制内容及由文件签名确认的媒体类型。 */
public record UserAvatar(byte[] data, String contentType) {
}
