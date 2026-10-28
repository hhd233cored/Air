package org.airchord.backend.interaction;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;

/** 评论的 JDBC 仓储；分页、可见状态和作者头像 URL 都在 SQL/映射边界明确处理。 */
@Repository
public class CommentRepository {

    private static final String SELECT_COLUMNS = """
            SELECT c.id, c.target_type, c.target_id, c.parent_id, c.content, c.status,
                   c.created_at, c.updated_at, u.id AS author_id, u.username,
                   u.avatar_updated_at
            FROM comments c JOIN users u ON u.id = c.user_id
            """;

    private final JdbcClient jdbc;

    public CommentRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Page listPublic(String type, String targetId, int page, int size) {
        String where = """
                WHERE c.target_type = :type AND c.target_id = :targetId AND c.status = 'VISIBLE'
                  AND (c.parent_id IS NULL OR EXISTS (
                      SELECT 1 FROM comments p WHERE p.id = c.parent_id AND p.status = 'VISIBLE'
                  ))
                """;
        long total = jdbc.sql("SELECT COUNT(*) FROM comments c " + where)
                .param("type", type).param("targetId", targetId)
                .query(Long.class).single();
        List<CommentResponse> rows = jdbc.sql(SELECT_COLUMNS + where + " ORDER BY c.created_at, c.id LIMIT :size OFFSET :offset")
                .param("type", type).param("targetId", targetId)
                .param("size", size).param("offset", (long) page * size)
                .query(this::map).list();
        return new Page(rows, total);
    }

    public Page listAdmin(String status, int page, int size) {
        String where = status == null ? "" : " WHERE c.status = :status";
        var count = jdbc.sql("SELECT COUNT(*) FROM comments c" + where);
        var query = jdbc.sql(SELECT_COLUMNS + where + " ORDER BY c.created_at DESC, c.id DESC LIMIT :size OFFSET :offset");
        if (status != null) {
            count.param("status", status);
            query.param("status", status);
        }
        long total = count.query(Long.class).single();
        List<CommentResponse> rows = query.param("size", size).param("offset", (long) page * size)
                .query(this::map).list();
        return new Page(rows, total);
    }

    public Parent findParent(long id) {
        return jdbc.sql("SELECT id, target_type, target_id, parent_id, status FROM comments WHERE id = :id")
                .param("id", id)
                .query((rs, row) -> new Parent(
                        rs.getLong("id"), rs.getString("target_type"), rs.getString("target_id"),
                        nullableLong(rs, "parent_id"), rs.getString("status")))
                .optional().orElse(null);
    }

    public CommentResponse create(String type, String targetId, long userId, Long parentId, String content) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        long id = jdbc.sql("""
                        INSERT INTO comments (target_type, target_id, user_id, parent_id, content, status, created_at, updated_at)
                        VALUES (:type, :targetId, :userId, :parentId, :content, 'VISIBLE', :now, :now)
                        RETURNING id
                        """)
                .param("type", type).param("targetId", targetId).param("userId", userId)
                .param("parentId", parentId).param("content", content).param("now", now)
                .query(Long.class).single();
        return find(id);
    }

    public CommentResponse find(long id) {
        return jdbc.sql(SELECT_COLUMNS + " WHERE c.id = :id")
                .param("id", id).query(this::map).optional().orElse(null);
    }

    public Long ownerId(long id) {
        return jdbc.sql("SELECT user_id FROM comments WHERE id = :id")
                .param("id", id).query(Long.class).optional().orElse(null);
    }

    public boolean softDelete(long id) {
        return jdbc.sql("UPDATE comments SET status = 'DELETED', updated_at = :now WHERE id = :id")
                .param("now", OffsetDateTime.now(ZoneOffset.UTC)).param("id", id).update() > 0;
    }

    public CommentResponse updateStatus(long id, String status) {
        int changed = jdbc.sql("UPDATE comments SET status = :status, updated_at = :now WHERE id = :id")
                .param("status", status).param("now", OffsetDateTime.now(ZoneOffset.UTC))
                .param("id", id).update();
        return changed == 0 ? null : find(id);
    }

    private CommentResponse map(ResultSet rs, int rowNumber) throws SQLException {
        long authorId = rs.getLong("author_id");
        OffsetDateTime avatarUpdated = rs.getObject("avatar_updated_at", OffsetDateTime.class);
        String avatarUrl = avatarUpdated == null ? null
                : "/api/v1/users/" + authorId + "/avatar?v="
                + URLEncoder.encode(avatarUpdated.toInstant().toString(), StandardCharsets.UTF_8).replace("+", "%20");
        return new CommentResponse(
                rs.getLong("id"), rs.getString("target_type"), rs.getString("target_id"),
                nullableLong(rs, "parent_id"), rs.getString("content"), rs.getString("status"),
                new CommentAuthor(authorId, rs.getString("username"), avatarUrl),
                instant(rs, "created_at"), instant(rs, "updated_at"));
    }

    private static String instant(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column, OffsetDateTime.class).toInstant().toString();
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    public record Page(List<CommentResponse> content, long totalElements) { }
    public record Parent(long id, String type, String targetId, Long parentId, String status) { }
}
