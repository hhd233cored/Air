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

/** 留言板专用表仓储，向 API 映射为 GUESTBOOK/main 评论目标。 */
@Repository
public class GuestbookRepository {

    private static final String SELECT_COLUMNS = """
            SELECT m.id, m.content, m.status, m.created_at, m.updated_at,
                   u.id AS author_id, u.username, u.avatar_updated_at
            FROM guestbook_messages m JOIN users u ON u.id = m.user_id
            """;

    private final JdbcClient jdbc;

    public GuestbookRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public CommentRepository.Page listPublic(int page, int size) {
        long total = jdbc.sql("SELECT COUNT(*) FROM guestbook_messages WHERE status = 'VISIBLE'")
                .query(Long.class).single();
        List<CommentResponse> rows = jdbc.sql(SELECT_COLUMNS + " WHERE m.status = 'VISIBLE' ORDER BY m.created_at DESC, m.id DESC LIMIT :size OFFSET :offset")
                .param("size", size).param("offset", (long) page * size)
                .query(this::map).list();
        return new CommentRepository.Page(rows, total);
    }

    public CommentResponse create(long userId, String content) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        long id = jdbc.sql("""
                        INSERT INTO guestbook_messages (user_id, content, status, created_at, updated_at)
                        VALUES (:userId, :content, 'VISIBLE', :now, :now) RETURNING id
                        """)
                .param("userId", userId).param("content", content).param("now", now)
                .query(Long.class).single();
        return find(id);
    }

    public CommentResponse find(long id) {
        return jdbc.sql(SELECT_COLUMNS + " WHERE m.id = :id")
                .param("id", id).query(this::map).optional().orElse(null);
    }

    public Long ownerId(long id) {
        return jdbc.sql("SELECT user_id FROM guestbook_messages WHERE id = :id AND status = 'VISIBLE'")
                .param("id", id).query(Long.class).optional().orElse(null);
    }

    public boolean softDelete(long id) {
        return jdbc.sql("UPDATE guestbook_messages SET status = 'DELETED', updated_at = :now WHERE id = :id")
                .param("now", OffsetDateTime.now(ZoneOffset.UTC)).param("id", id).update() > 0;
    }

    private CommentResponse map(ResultSet rs, int rowNumber) throws SQLException {
        long authorId = rs.getLong("author_id");
        OffsetDateTime avatarUpdated = rs.getObject("avatar_updated_at", OffsetDateTime.class);
        String avatarUrl = avatarUpdated == null ? null
                : "/api/v1/users/" + authorId + "/avatar?v="
                + URLEncoder.encode(avatarUpdated.toInstant().toString(), StandardCharsets.UTF_8).replace("+", "%20");
        return new CommentResponse(
                rs.getLong("id"), "GUESTBOOK", "main", null, rs.getString("content"), rs.getString("status"),
                new CommentAuthor(authorId, rs.getString("username"), avatarUrl),
                rs.getObject("created_at", OffsetDateTime.class).toInstant().toString(),
                rs.getObject("updated_at", OffsetDateTime.class).toInstant().toString());
    }
}
