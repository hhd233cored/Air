package org.airchord.backend.auth;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;

/**
 * 用户与注册设置的 PostgreSQL 仓储。
 * Session 放在 Redis；用户名、角色和 Argon2id 密码哈希仍以 PostgreSQL 为准。
 */
@Repository
public class AuthUserRepository {

    private static final String USER_COLUMNS = """
            SELECT id, username, password_hash, role, enabled, avatar_updated_at, security_version
            FROM users
            """;

    private final JdbcClient jdbcClient;

    public AuthUserRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public AuthUserRecord findByUsername(String username) {
        return jdbcClient.sql(USER_COLUMNS + " WHERE lower(username) = lower(:username) LIMIT 1")
                .param("username", username)
                .query(this::mapUser)
                .optional()
                .orElse(null);
    }

    public AuthUserRecord findById(long id) {
        return jdbcClient.sql(USER_COLUMNS + " WHERE id = :id")
                .param("id", id)
                .query(this::mapUser)
                .optional()
                .orElse(null);
    }

    public AuthUserRecord insertUser(String username, String passwordHash, String role) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        long id = jdbcClient.sql("""
                        INSERT INTO users (username, password_hash, role, enabled, created_at, updated_at)
                        VALUES (:username, :passwordHash, :role, TRUE, :now, :now)
                        RETURNING id
                        """)
                .param("username", username)
                .param("passwordHash", passwordHash)
                .param("role", role)
                .param("now", now)
                .query(Long.class)
                .single();
        return findById(id);
    }

    public AuthUserRecord updateAvatar(long userId, byte[] data, String contentType) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        int updated = jdbcClient.sql("""
                        UPDATE users
                        SET avatar_data = :data, avatar_content_type = :contentType,
                            avatar_updated_at = :now, updated_at = :now
                        WHERE id = :id
                        """)
                .param("data", data)
                .param("contentType", contentType)
                .param("now", now)
                .param("id", userId)
                .update();
        return updated == 0 ? null : findById(userId);
    }

    public AuthUserRecord deleteAvatar(long userId) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        int updated = jdbcClient.sql("""
                        UPDATE users
                        SET avatar_data = NULL, avatar_content_type = NULL,
                            avatar_updated_at = NULL, updated_at = :now
                        WHERE id = :id
                        """)
                .param("now", now)
                .param("id", userId)
                .update();
        return updated == 0 ? null : findById(userId);
    }

    /** 管理页按创建时间倒序读取用户，并在 SQL 层应用可选筛选条件。 */
    public AdminUserPage listAdminUsers(String query, String role, Boolean enabled, int page, int size) {
        StringBuilder where = new StringBuilder(" WHERE TRUE");
        if (query != null && !query.isBlank()) where.append(" AND username ILIKE :query");
        if (role != null) where.append(" AND role = :role");
        if (enabled != null) where.append(" AND enabled = :enabled");
        var count = jdbcClient.sql("SELECT COUNT(*) FROM users" + where);
        var rows = jdbcClient.sql("""
                SELECT id, username, role, enabled, avatar_updated_at, created_at, updated_at
                FROM users
                """ + where + " ORDER BY created_at DESC, id DESC LIMIT :size OFFSET :offset");
        if (query != null && !query.isBlank()) {
            count.param("query", "%" + query.strip() + "%");
            rows.param("query", "%" + query.strip() + "%");
        }
        if (role != null) { count.param("role", role); rows.param("role", role); }
        if (enabled != null) { count.param("enabled", enabled); rows.param("enabled", enabled); }
        long total = count.query(Long.class).single();
        List<AdminUserRecord> users = rows.param("size", size).param("offset", (long) page * size)
                .query((rs, row) -> mapAdminUser(rs)).list();
        return new AdminUserPage(users, total);
    }

    public AdminUserRecord findAdminUser(long id) {
        return jdbcClient.sql("""
                        SELECT id, username, role, enabled, avatar_updated_at, created_at, updated_at
                        FROM users WHERE id = :id
                        """)
                .param("id", id).query((rs, row) -> mapAdminUser(rs)).optional().orElse(null);
    }

    public AdminUserRecord createAdminUser(String username, String passwordHash, String role, boolean enabled) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        long id = jdbcClient.sql("""
                        INSERT INTO users (username, password_hash, role, enabled, created_at, updated_at)
                        VALUES (:username, :passwordHash, :role, :enabled, :now, :now) RETURNING id
                        """)
                .param("username", username).param("passwordHash", passwordHash).param("role", role)
                .param("enabled", enabled).param("now", now).query(Long.class).single();
        return findAdminUser(id);
    }

    /** 锁住全部账号行，将并发管理员变更串行化，避免两个请求移除最后两位管理员。 */
    public void lockAdminChanges() {
        // 先按固定顺序锁定用户行；并发降权请求会串行执行并重新统计管理员数量。
        jdbcClient.sql("SELECT id FROM users ORDER BY id FOR UPDATE").query(Long.class).list();
    }

    public long countEnabledAdmins() {
        return jdbcClient.sql("SELECT COUNT(*) FROM users WHERE role = 'ADMIN' AND enabled = TRUE")
                .query(Long.class).single();
    }

    public void updateRoleAndEnabled(long id, String role, Boolean enabled) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        jdbcClient.sql("""
                        UPDATE users SET role = COALESCE(:role, role), enabled = COALESCE(:enabled, enabled),
                          security_version = security_version + CASE WHEN :role IS NOT NULL OR :enabled IS NOT NULL THEN 1 ELSE 0 END,
                          updated_at = :now
                        WHERE id = :id
                        """)
                .param("role", role).param("enabled", enabled).param("now", now).param("id", id).update();
    }

    public void updatePassword(long id, String passwordHash) {
        jdbcClient.sql("UPDATE users SET password_hash = :hash, security_version = security_version + 1, updated_at = :now WHERE id = :id")
                .param("hash", passwordHash).param("now", OffsetDateTime.now(ZoneOffset.UTC)).param("id", id).update();
    }

    public void updateRegistrationSetting(boolean enabled) {
        jdbcClient.sql("""
                        INSERT INTO auth_settings (key, value, updated_at)
                        VALUES ('registration_enabled', :value, :now)
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
                        """)
                .param("value", Boolean.toString(enabled)).param("now", OffsetDateTime.now(ZoneOffset.UTC)).update();
    }

    private static AdminUserRecord mapAdminUser(ResultSet rs) throws SQLException {
        OffsetDateTime avatarAt = rs.getObject("avatar_updated_at", OffsetDateTime.class);
        OffsetDateTime createdAt = rs.getObject("created_at", OffsetDateTime.class);
        OffsetDateTime updatedAt = rs.getObject("updated_at", OffsetDateTime.class);
        return new AdminUserRecord(rs.getLong("id"), rs.getString("username"), rs.getString("role"),
                rs.getBoolean("enabled"), avatarAt == null ? null : avatarAt.toInstant().toString(),
                createdAt == null ? null : createdAt.toInstant().toString(),
                updatedAt == null ? null : updatedAt.toInstant().toString());
    }

    public UserAvatar findAvatar(long userId) {
        return jdbcClient.sql("""
                        SELECT avatar_data, avatar_content_type
                        FROM users
                        WHERE id = :id AND avatar_data IS NOT NULL AND avatar_content_type IS NOT NULL
                        """)
                .param("id", userId)
                .query((resultSet, rowNumber) -> new UserAvatar(
                        resultSet.getBytes("avatar_data"), resultSet.getString("avatar_content_type")))
                .optional()
                .orElse(null);
    }

    /** 初始开关只写一次；之后的管理接口可以更新数据库中的持久值。 */
    public void initializeRegistrationSetting(boolean enabled) {
        jdbcClient.sql("""
                        INSERT INTO auth_settings (key, value, updated_at)
                        VALUES ('registration_enabled', :value, :now)
                        ON CONFLICT (key) DO NOTHING
                        """)
                .param("value", Boolean.toString(enabled))
                .param("now", OffsetDateTime.now(ZoneOffset.UTC))
                .update();
    }

    public boolean isRegistrationEnabled() {
        String value = jdbcClient.sql("SELECT value FROM auth_settings WHERE key = 'registration_enabled'")
                .query(String.class)
                .optional()
                .orElse("true");
        return "true".equalsIgnoreCase(value) || "1".equals(value) || "yes".equalsIgnoreCase(value);
    }

    private AuthUserRecord mapUser(ResultSet resultSet, int rowNumber) throws SQLException {
        OffsetDateTime avatarUpdatedAt = resultSet.getObject("avatar_updated_at", OffsetDateTime.class);
        return new AuthUserRecord(
                resultSet.getLong("id"),
                resultSet.getString("username"),
                resultSet.getString("password_hash"),
                resultSet.getString("role"),
                resultSet.getBoolean("enabled"),
                avatarUpdatedAt == null ? null : avatarUpdatedAt.toInstant().toString(),
                resultSet.getLong("security_version")
        );
    }

    public record AdminUserRecord(long id, String username, String role, boolean enabled,
                                  String avatarUpdatedAt, String createdAt, String updatedAt) { }
    public record AdminUserPage(List<AdminUserRecord> content, long totalElements) { }
}
