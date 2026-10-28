package org.airchord.backend.metrics;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import javax.sql.DataSource;
import java.sql.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ArticleMetricPublisherMarkJdbcTest {
    @AfterEach void clear() { ArticleMetricPublisherTiming.clear(); ArticleMetricTiming.clear(); }
    @Test void onlyMarkPhaseInstrumentsAndKeepsJdbcIdentityAndUpdateCount() throws Exception {
        var source=mock(DataSource.class);var raw=mock(Connection.class);var sql=mock(PreparedStatement.class);
        when(source.getConnection()).thenReturn(raw);when(raw.prepareStatement("UPDATE outbox SET published=true")).thenReturn(sql);
        when(sql.executeUpdate()).thenReturn(200);
        var wrapper=new ArticleMetricPerfDataSource(source);
        assertThat(wrapper.getConnection()).isSameAs(raw);
        var timing=ArticleMetricPublisherTiming.begin(true);
        assertThat(wrapper.getConnection()).isSameAs(raw); // CLAIM is not counted as mark.
        timing.phase=ArticleMetricPublisherTiming.Phase.MARK;
        var connection=wrapper.getConnection();var statement=connection.prepareStatement("UPDATE outbox SET published=true");
        assertThat(statement.getConnection()).isSameAs(connection);
        assertThat(statement.unwrap(PreparedStatement.class)).isSameAs(statement);
        assertThat(connection.unwrap(Connection.class)).isSameAs(connection);
        assertThat(statement.executeUpdate()).isEqualTo(200);connection.commit();connection.close();connection.close();
        var sample=timing.markJdbc;
        assertThat(sample.borrowed).isEqualTo(1);assertThat(sample.closed).isEqualTo(1);
        assertThat(sample.prepareCalls).isEqualTo(1);assertThat(sample.executeCalls).isEqualTo(1);
        assertThat(sample.updatedRows).isEqualTo(200);assertThat(sample.commitCalls).isEqualTo(1);
        assertThat(sample.execute).isPositive();assertThat(sample.commit).isPositive();assertThat(sample.hold).isPositive();
        assertThat(sample.summary()).doesNotContainKeys("sql","ids","parameters");
        verify(raw).commit();verify(raw,times(2)).close();
    }
    @Test void originalSqlAndCommitFailuresPropagateAndRollbackIsMeasured() throws Exception {
        var source=mock(DataSource.class);var raw=mock(Connection.class);var sql=mock(PreparedStatement.class);
        var executeFailure=new SQLException("constraint","23514");var commitFailure=new SQLException("connection","08006");
        when(source.getConnection()).thenReturn(raw);when(raw.prepareStatement("UPDATE outbox")).thenReturn(sql);
        when(sql.executeUpdate()).thenThrow(executeFailure);doThrow(commitFailure).when(raw).commit();
        var timing=ArticleMetricPublisherTiming.begin(true);timing.phase=ArticleMetricPublisherTiming.Phase.MARK;
        try(var connection=new ArticleMetricPerfDataSource(source).getConnection()){
            assertThatThrownBy(()->connection.prepareStatement("UPDATE outbox").executeUpdate()).isSameAs(executeFailure);
            assertThatThrownBy(connection::commit).isSameAs(commitFailure);connection.rollback();
        }
        assertThat(timing.markJdbc.executeFailures).isEqualTo(1);assertThat(timing.markJdbc.commitFailures).isEqualTo(1);
        assertThat(timing.markJdbc.rollbackCalls).isEqualTo(1);assertThat(timing.markJdbc.updatedRows).isZero();
        assertThat(timing.markJdbc.closed).isEqualTo(1);verify(raw).rollback();
    }
    @Test void failedCloseCanBeRetriedAndLeaseIsOnlyCountedOnce() throws Exception {
        var source=mock(DataSource.class);var raw=mock(Connection.class);var failure=new SQLException("close");
        when(source.getConnection()).thenReturn(raw);doThrow(failure).doNothing().when(raw).close();
        var timing=ArticleMetricPublisherTiming.begin(true);timing.phase=ArticleMetricPublisherTiming.Phase.MARK;
        var connection=new ArticleMetricPerfDataSource(source).getConnection();
        assertThatThrownBy(connection::close).isSameAs(failure);assertThat(timing.markJdbc.closed).isZero();
        connection.close();assertThat(timing.markJdbc.closed).isEqualTo(1);assertThat(timing.markJdbc.closeFailures).isEqualTo(1);
    }
}
