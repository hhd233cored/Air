package org.airchord.backend.metrics;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import javax.sql.DataSource;
import java.sql.*;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ArticleMetricPerfDataSourceTest {
    @AfterEach void clearRequest() { ArticleMetricTiming.clear(); }

    @Test void normalAndDisabledRequestsKeepOriginalConnection() throws Exception {
        var source = mock(DataSource.class);
        var raw = mock(Connection.class);
        when(source.getConnection()).thenReturn(raw);
        var wrapper = new ArticleMetricPerfDataSource(source);
        assertThat(wrapper.getConnection()).isSameAs(raw);
        ArticleMetricTiming.begin(false);
        assertThat(wrapper.getConnection()).isSameAs(raw);
        assertThat(ArticleMetricTiming.current().borrowed).isZero();
        assertThat(ArticleMetricTiming.countsHeader()).isNull();
        assertThat(ArticleMetricTiming.serverTiming(0, 0, 0)).doesNotContain("dbHold");
    }

    @Test void queryResultsRetainJdbcIdentityAndLeaseIsCountedOnce() throws Exception {
        var source = mock(DataSource.class);
        var raw = mock(Connection.class);
        var query = mock(PreparedStatement.class);
        var rows = mock(ResultSet.class);
        when(source.getConnection()).thenReturn(raw);
        when(raw.prepareStatement("SELECT id FROM users WHERE id=?")).thenReturn(query);
        when(query.executeQuery()).thenReturn(rows);
        when(rows.next()).thenReturn(true);
        when(rows.getLong(1)).thenReturn(1002L);
        ArticleMetricTiming.begin(true);
        var connection = new ArticleMetricPerfDataSource(source).getConnection();
        var statement = connection.prepareStatement("SELECT id FROM users WHERE id=?");
        statement.setLong(1, 1002L);
        var result = statement.executeQuery();
        assertThat(result.next()).isTrue();
        assertThat(result.getLong(1)).isEqualTo(1002L);
        assertThat(result.getStatement()).isSameAs(statement);
        assertThat(statement.getConnection()).isSameAs(connection);
        assertThat(connection.unwrap(Connection.class)).isSameAs(connection);
        assertThat(statement.unwrap(PreparedStatement.class)).isSameAs(statement);
        assertThat(connection.isWrapperFor(Connection.class)).isTrue();
        assertThat(connection.equals(connection)).isTrue();
        result.close(); statement.close(); connection.close(); connection.close();
        var sample = ArticleMetricTiming.current();
        assertThat(sample.borrowed).isEqualTo(1);
        assertThat(sample.closed).isEqualTo(1);
        assertThat(sample.accountLoans).isEqualTo(1);
        assertThat(sample.sqlCalls).isEqualTo(1);
        assertThat(sample.executeAccount).isPositive();
        assertThat(sample.read).isPositive();
        assertThat(sample.holdAccount).isEqualTo(sample.hold);
        verify(query).setLong(1, 1002L);
        verify(raw, times(2)).close();
    }

    @Test void factAndOutboxShareOneWriteLeaseWithOneCommit() throws Exception {
        var source = mock(DataSource.class);
        var raw = mock(Connection.class);
        var fact = mock(PreparedStatement.class);
        var outbox = mock(PreparedStatement.class);
        when(source.getConnection()).thenReturn(raw);
        when(raw.prepareStatement("INSERT INTO article_likes VALUES (?,?)")).thenReturn(fact);
        when(raw.prepareStatement("INSERT INTO article_metric_outbox VALUES (?)")).thenReturn(outbox);
        when(fact.executeUpdate()).thenReturn(1);
        when(outbox.executeUpdate()).thenReturn(1);
        ArticleMetricTiming.begin(true);
        try (var connection = new ArticleMetricPerfDataSource(source).getConnection()) {
            connection.setAutoCommit(false);
            assertThat(connection.prepareStatement("INSERT INTO article_likes VALUES (?,?)").executeUpdate()).isEqualTo(1);
            assertThat(connection.prepareStatement("INSERT INTO article_metric_outbox VALUES (?)").executeUpdate()).isEqualTo(1);
            connection.commit();
        }
        var sample = ArticleMetricTiming.current();
        assertThat(sample.writeLoans).isEqualTo(1);
        assertThat(sample.commitCalls).isEqualTo(1);
        assertThat(sample.executeFact).isPositive();
        assertThat(sample.executeOutbox).isPositive();
        assertThat(sample.jdbcCommit).isPositive();
        assertThat(sample.sqlCalls).isEqualTo(2);
        assertThat(sample.sqlFailures).isZero();
        verify(raw).commit();
    }

    @Test void sqlAndCommitExceptionsKeepTheirOriginalTypeAndRollbackIsDelegated() throws Exception {
        var source = mock(DataSource.class);
        var raw = mock(Connection.class);
        var statement = mock(PreparedStatement.class);
        var sqlFailure = new SQLException("constraint", "23514");
        var commitFailure = new SQLException("commit failed", "08006");
        when(source.getConnection()).thenReturn(raw);
        when(raw.prepareStatement("INSERT INTO article_view_events VALUES (?)")).thenReturn(statement);
        when(statement.executeUpdate()).thenThrow(sqlFailure);
        doThrow(commitFailure).when(raw).commit();
        ArticleMetricTiming.begin(true);
        try (var connection = new ArticleMetricPerfDataSource(source).getConnection()) {
            assertThatThrownBy(() -> connection.prepareStatement("INSERT INTO article_view_events VALUES (?)").executeUpdate())
                    .isSameAs(sqlFailure);
            assertThatThrownBy(connection::commit).isSameAs(commitFailure);
            connection.rollback();
        }
        var sample = ArticleMetricTiming.current();
        assertThat(sample.sqlFailures).isEqualTo(1);
        assertThat(sample.commitFailures).isEqualTo(1);
        assertThat(sample.rollbackCalls).isEqualTo(1);
        assertThat(sample.jdbcRollback).isPositive();
        assertThat(sample.closed).isEqualTo(1);
        verify(raw).rollback();
    }

    @Test void failedCloseCanBeRetriedWithoutChangingTheException() throws Exception {
        var source = mock(DataSource.class);
        var raw = mock(Connection.class);
        var failure = new SQLException("close failed");
        when(source.getConnection()).thenReturn(raw);
        doThrow(failure).doNothing().when(raw).close();
        ArticleMetricTiming.begin(true);
        var connection = new ArticleMetricPerfDataSource(source).getConnection();
        assertThatThrownBy(connection::close).isSameAs(failure);
        assertThat(ArticleMetricTiming.current().closed).isZero();
        connection.close();
        assertThat(ArticleMetricTiming.current().closed).isEqualTo(1);
        assertThat(ArticleMetricTiming.current().closeFailures).isEqualTo(1);
        assertThat(ArticleMetricTiming.current().otherLoans).isEqualTo(1);
    }
}
