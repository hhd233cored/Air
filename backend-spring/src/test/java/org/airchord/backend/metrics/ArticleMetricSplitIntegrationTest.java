package org.airchord.backend.metrics;

import com.zaxxer.hikari.HikariDataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
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
import static org.assertj.core.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="AIRCHORD_TEST_JDBC_URL",matches=".+")
class ArticleMetricSplitIntegrationTest {
    @Test void keepsFactOutboxAtomicAndBackgroundApplyAtomicWithPinnedTransactions() throws Exception {
        String url=System.getenv("AIRCHORD_TEST_JDBC_URL"),user=System.getenv("AIRCHORD_TEST_DB_USER"),password=System.getenv("AIRCHORD_TEST_DB_PASSWORD");
        var admin=new JdbcTemplate(new DriverManagerDataSource(url,user,password));
        String schema="metric_split_test_"+UUID.randomUUID().toString().replace("-","");
        admin.execute("CREATE SCHEMA "+schema);
        var raw=new HikariDataSource();raw.setJdbcUrl(url+(url.contains("?")?"&":"?")+"currentSchema="+schema);
        raw.setUsername(user);raw.setPassword(password);raw.setMaximumPoolSize(20);raw.setMinimumIdle(20);
        var processor=new ArticleMetricPerfConnectionMetrics(true,4);processor.postProcessBeforeInitialization(raw,"dataSource");
        try(var source=(ArticleMetricSplitDataSource)processor.postProcessAfterInitialization(raw,"dataSource")){
            Flyway.configure().dataSource(source).defaultSchema(schema).locations("classpath:db/migration","classpath:db/fixtures").load().migrate();
            var jdbc=JdbcClient.create(source);var manager=new DataSourceTransactionManager(source);var tx=new TransactionTemplate(manager);
            var factory=new ProxyFactory(new ArticleMetricRepository(jdbc, new JdbcTemplate(source), true));factory.addAdvice(new TransactionInterceptor(manager,new AnnotationTransactionAttributeSource()));
            var repository=(ArticleMetricRepository)factory.getProxy();String article=repository.publishedArticleId("learning-spring");
            tx.execute(status->{long pid=jdbc.sql("SELECT pg_backend_pid()").query(Long.class).single();
                assertThat(raw.getHikariPoolMXBean().getActiveConnections()).isEqualTo(1);
                try(var scope=ArticleMetricBackgroundScope.enter()){assertThat(jdbc.sql("SELECT pg_backend_pid()").query(Long.class).single()).isEqualTo(pid);}
                return null;});
            jdbc.sql("ALTER TABLE article_metric_outbox ADD CONSTRAINT reject_split_test CHECK (delta=-1) NOT VALID").update();
            assertThatThrownBy(()->repository.recordView(article,UUID.randomUUID(),null)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
            assertThat(jdbc.sql("SELECT count(*) FROM article_view_events").query(Long.class).single()).isZero();
            jdbc.sql("ALTER TABLE article_metric_outbox DROP CONSTRAINT reject_split_test").update();
            repository.recordView(article,UUID.randomUUID(),null);
            try(var scope=ArticleMetricBackgroundScope.enter()){
                tx.execute(status->{jdbc.sql("SELECT 1").query(Integer.class).single();
                    assertThat(raw.getHikariPoolMXBean().getActiveConnections()).isZero();
                    assertThat(source.backgroundPool().getHikariPoolMXBean().getActiveConnections()).isEqualTo(1);return null;});
                var events=repository.claimOutbox(100);
                jdbc.sql("ALTER TABLE article_stats ADD CONSTRAINT reject_split_stats CHECK (view_count=0) NOT VALID").update();
                assertThatThrownBy(()->repository.applyBatch(events)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
                assertThat(jdbc.sql("SELECT count(*) FROM article_metric_processed").query(Long.class).single()).isZero();
                jdbc.sql("ALTER TABLE article_stats DROP CONSTRAINT reject_split_stats").update();
                assertThat(repository.applyBatch(events).eventIds()).hasSize(1);
                assertThat(repository.applyBatch(events).eventIds()).isEmpty();
                var ids=events.stream().map(ArticleMetricRepository.Event::id).toList();
                jdbc.sql("ALTER TABLE article_metric_outbox ADD CONSTRAINT reject_mark_test CHECK (published_at IS NULL) NOT VALID").update();
                var failed=ArticleMetricPublisherTiming.begin(true);failed.phase=ArticleMetricPublisherTiming.Phase.MARK;
                try {
                    assertThatThrownBy(()->repository.markPublishedBatch(ids)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
                    assertThat(failed.markJdbc.executeFailures).isEqualTo(1);
                    assertThat(failed.markJdbc.rollbackCalls).isEqualTo(1);
                    assertThat(failed.markJdbc.commitCalls).isZero();assertThat(failed.markJdbc.closed).isEqualTo(1);
                } finally { ArticleMetricPublisherTiming.clear(); }
                assertThat(jdbc.sql("SELECT count(*) FROM article_metric_outbox WHERE published_at IS NOT NULL").query(Long.class).single()).isZero();
                jdbc.sql("ALTER TABLE article_metric_outbox DROP CONSTRAINT reject_mark_test").update();
                var marked=ArticleMetricPublisherTiming.begin(true);marked.phase=ArticleMetricPublisherTiming.Phase.MARK;
                try {
                    assertThat(repository.markPublishedBatch(ids)).isEqualTo(1);
                    assertThat(marked.markJdbc.borrowed).isEqualTo(1);assertThat(marked.markJdbc.closed).isEqualTo(1);
                    assertThat(marked.markJdbc.prepareCalls).isEqualTo(1);assertThat(marked.markJdbc.executeCalls).isEqualTo(1);
                    assertThat(marked.markJdbc.updatedRows).isEqualTo(1);assertThat(marked.markJdbc.commitCalls).isEqualTo(1);
                    assertThat(marked.markJdbc.backendPid).isPositive();
                    assertThat(marked.markJdbc.execute).isPositive();assertThat(marked.markJdbc.commit).isPositive();
                } finally { ArticleMetricPublisherTiming.clear(); }
                assertThat(repository.markPublishedBatch(ids)).isZero();
            }
            assertThat(repository.counts(article).viewCount()).isEqualTo(1);
            assertThat(ArticleMetricBackgroundScope.active()).isFalse();
        }finally{ArticleMetricPublisherTiming.clear();raw.close();admin.execute("DROP SCHEMA "+schema+" CASCADE");}
    }
}

