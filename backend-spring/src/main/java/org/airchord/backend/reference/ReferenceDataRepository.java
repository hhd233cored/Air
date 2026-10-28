package org.airchord.backend.reference;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * 只读查询阶段 0 的合成夹具，用来演示 Spring JDBC 的参数绑定与标量查询。
 * 此类不连接 Python 的 SQLite，也不向 HTTP 接口暴露用户或评论数据。
 */
@Repository
public class ReferenceDataRepository {

    private final JdbcClient jdbcClient;

    public ReferenceDataRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public long countUsers() {
        return jdbcClient.sql("SELECT COUNT(*) FROM users")
                .query(Long.class)
                .single();
    }

    public long countContent(String contentType, String status) {
        return jdbcClient.sql("""
                        SELECT COUNT(*)
                        FROM content_items
                        WHERE content_type = :contentType AND status = :status
                        """)
                .param("contentType", contentType)
                .param("status", status)
                .query(Long.class)
                .single();
    }

    public long countComments() {
        return jdbcClient.sql("SELECT COUNT(*) FROM comments")
                .query(Long.class)
                .single();
    }
}
