package org.airchord.backend.metrics;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;

/** Only enabled by the perf BeanPostProcessor. One logical DataSource keeps Spring transaction binding intact. */
final class ArticleMetricSplitDataSource extends DelegatingDataSource implements AutoCloseable {
    private final DataSource background;
    private final HikariDataSource backgroundPool;
    ArticleMetricSplitDataSource(DataSource http, DataSource background, HikariDataSource backgroundPool) {
        super(http); this.background = background; this.backgroundPool = backgroundPool;
    }
    private DataSource selected() {
        // Spring reuses an already bound connection. Never move an existing transaction to another pool.
        return ArticleMetricBackgroundScope.active() ? background : getTargetDataSource();
    }
    @Override public Connection getConnection() throws SQLException { return selected().getConnection(); }
    @Override public Connection getConnection(String user, String password) throws SQLException {
        return selected().getConnection(user, password);
    }
    HikariDataSource backgroundPool() { return backgroundPool; }
    @Override public void close() throws Exception {
        try { if (getTargetDataSource() instanceof AutoCloseable closeable) closeable.close(); }
        finally { backgroundPool.close(); }
    }
}
