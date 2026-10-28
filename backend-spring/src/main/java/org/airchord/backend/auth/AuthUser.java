package org.airchord.backend.auth;

/** 与现有前端 AuthUser DTO 保持字段名称一致。 */
public record AuthUser(long id, String username, String role, String avatarUrl) {
}
