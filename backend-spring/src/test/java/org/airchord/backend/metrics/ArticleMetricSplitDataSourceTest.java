package org.airchord.backend.metrics;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;
import javax.sql.DataSource;
import java.sql.Connection;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ArticleMetricSplitDataSourceTest {
    @Test void routesBackgroundAndRestoresNestedScopeAfterFailure() throws Exception {
        var http=mock(DataSource.class); var background=mock(DataSource.class); var pool=mock(HikariDataSource.class);
        var httpConnection=mock(Connection.class); var backgroundConnection=mock(Connection.class);
        when(http.getConnection()).thenReturn(httpConnection); when(background.getConnection()).thenReturn(backgroundConnection);
        var source=new ArticleMetricSplitDataSource(http,background,pool);
        assertThat(source.getConnection()).isSameAs(httpConnection);
        assertThatThrownBy(()->{try(var outer=ArticleMetricBackgroundScope.enter()){
            assertThat(source.getConnection()).isSameAs(backgroundConnection);
            try(var inner=ArticleMetricBackgroundScope.enter()){assertThat(source.getConnection()).isSameAs(backgroundConnection);}
            assertThat(ArticleMetricBackgroundScope.active()).isTrue(); throw new IllegalStateException("test failure");
        }}).isInstanceOf(IllegalStateException.class);
        assertThat(ArticleMetricBackgroundScope.active()).isFalse();
        assertThat(source.getConnection()).isSameAs(httpConnection);
        source.close(); verify(pool).close();
    }

    @Test void splitsTheExistingBudgetAndKeepsDefaultSinglePool() throws Exception {
        var raw=new HikariDataSource(); raw.setMaximumPoolSize(20);raw.setMinimumIdle(20);raw.setJdbcUrl("jdbc:postgresql://localhost/test");
        var processor=new ArticleMetricPerfConnectionMetrics(true,4);
        processor.postProcessBeforeInitialization(raw,"dataSource");
        try(var split=(ArticleMetricSplitDataSource)processor.postProcessAfterInitialization(raw,"dataSource")){
            assertThat(raw.getMaximumPoolSize()).isEqualTo(16);assertThat(raw.getMinimumIdle()).isEqualTo(16);
            assertThat(split.backgroundPool().getMaximumPoolSize()).isEqualTo(4);
            assertThat(split.backgroundPool().getMinimumIdle()).isEqualTo(4);
            assertThat(split.backgroundPool().getJdbcUrl()).isEqualTo(raw.getJdbcUrl());
        }
        var shared=new HikariDataSource();
        var defaultProcessor=new ArticleMetricPerfConnectionMetrics(false,0);
        assertThat(defaultProcessor.postProcessAfterInitialization(shared,"dataSource")).isSameAs(shared);
        shared.close();
    }
}
