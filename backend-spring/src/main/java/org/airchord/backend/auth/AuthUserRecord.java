package org.airchord.backend.auth;

/** PostgreSQL 用户表的内部投影；密码哈希不进入 API DTO。 */
public record AuthUserRecord(
        long id,
        String username,
        String passwordHash,
        String role,
        boolean enabled,
        String avatarUpdatedAt,
        long securityVersion
) {
}
