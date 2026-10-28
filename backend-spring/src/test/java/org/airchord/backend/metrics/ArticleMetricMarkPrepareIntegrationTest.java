package org.airchord.backend.metrics;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.UUID;
import java.util.List;
import static org.assertj.core.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="AIRCHORD_TEST_JDBC_URL", matches=".+")
class ArticleMetricMarkPrepareIntegrationTest {
    @ParameterizedTest @ValueSource(booleans={false,true})
    void repeatedBulkMarksKeepBindingRollbackIdempotencyAndConnectionPolicy(boolean disabled) throws Exception {
        String url=System.getenv("AIRCHORD_TEST_JDBC_URL"), user=System.getenv("AIRCHORD_TEST_DB_USER"), password=System.getenv("AIRCHORD_TEST_DB_PASSWORD");
        var admin=new JdbcTemplate(new DriverManagerDataSource(url,user,password));
        String schema="metric_prepare_test_"+UUID.randomUUID().toString().replace("-","");
        admin.execute("CREATE SCHEMA "+schema);
        try(var raw=new HikariDataSource()) {
            raw.setJdbcUrl(url+(url.contains("?")?"&":"?")+"currentSchema="+schema);
            raw.setUsername(user);raw.setPassword(password);raw.setMaximumPoolSize(1);raw.setMinimumIdle(1);
            var source=new ArticleMetricPerfDataSource(raw);var template=new JdbcTemplate(source);var jdbc=JdbcClient.create(source);
            template.execute("CREATE TABLE article_metric_outbox(id uuid PRIMARY KEY,published_at timestamptz,claimed_until timestamptz)");
            var ids=java.util.stream.IntStream.range(0,200).mapToObj(i->UUID.randomUUID()).toList();
            template.batchUpdate("INSERT INTO article_metric_outbox(id,claimed_until) VALUES (?,now()+interval '30 seconds')",ids,200,(ps,id)->ps.setObject(1,id));
            var manager=new DataSourceTransactionManager(source);var tx=new TransactionTemplate(manager);
            var factory=new ProxyFactory(new ArticleMetricRepository(jdbc,template,disabled));
            factory.addAdvice(new TransactionInterceptor(manager,new AnnotationTransactionAttributeSource()));
            var repository=(ArticleMetricRepository)factory.getProxy();
            long pid=jdbc.sql("SELECT pg_backend_pid()").query(Long.class).single();
            for(int repetition=0;repetition<15;repetition++) {
                var timing=ArticleMetricPublisherTiming.begin(true);timing.phase=ArticleMetricPublisherTiming.Phase.MARK;
                try {
                tx.execute(status->{
                        assertThat(repository.markPublishedBatch(ids)).isEqualTo(200);
                        assertThat(timing.markJdbc.serverPrepareThreshold).isEqualTo(disabled?0:5);
                        assertThat(timing.markJdbc.executeCalls).isEqualTo(1);
                        assertThat(timing.markJdbc.updatedRows).isEqualTo(200);
                        assertThat(timing.markJdbc.backendPid).isEqualTo((int)pid);
                    status.setRollbackOnly();return null;
                });
                assertThat(timing.markJdbc.closed).isEqualTo(1);
                assertThat(timing.markJdbc.rollbackCalls).isEqualTo(1);
                } finally {ArticleMetricPublisherTiming.clear();}
                assertThat(jdbc.sql("SELECT count(*) FROM article_metric_outbox WHERE published_at IS NULL AND claimed_until IS NOT NULL").query(Long.class).single()).isEqualTo(200);
            }
            long prepared=jdbc.sql("SELECT count(*) FROM pg_prepared_statements WHERE statement LIKE 'UPDATE article_metric_outbox SET published_at%'").query(Long.class).single();
            if(disabled)assertThat(prepared).isZero();else assertThat(prepared).isPositive();
            try(var connection=raw.getConnection()) {
                assertThat(connection.unwrap(org.postgresql.PGConnection.class).getPrepareThreshold()).isEqualTo(5);
                try(var other=connection.prepareStatement("SELECT ?::integer")) {
                    assertThat(other.unwrap(org.postgresql.PGStatement.class).getPrepareThreshold()).isEqualTo(5);
                }
            }
            assertThat(repository.markPublishedBatch(ids)).isEqualTo(200);
            var firstPublished=jdbc.sql("SELECT min(published_at) FROM article_metric_outbox").query(java.time.OffsetDateTime.class).single();
            assertThat(repository.markPublishedBatch(ids)).isZero();
            assertThat(repository.markPublishedBatch(List.of())).isZero();
            assertThat(jdbc.sql("SELECT min(published_at) FROM article_metric_outbox").query(java.time.OffsetDateTime.class).single()).isEqualTo(firstPublished);
            assertThat(jdbc.sql("SELECT count(*) FROM article_metric_outbox WHERE claimed_until IS NULL").query(Long.class).single()).isEqualTo(200);
            assertThat(jdbc.sql("SELECT pg_backend_pid()").query(Long.class).single()).isEqualTo(pid);
            assertThat(raw.getHikariPoolMXBean().getActiveConnections()).isZero();
        } finally {ArticleMetricPublisherTiming.clear();admin.execute("DROP SCHEMA "+schema+" CASCADE");}
    }
}
