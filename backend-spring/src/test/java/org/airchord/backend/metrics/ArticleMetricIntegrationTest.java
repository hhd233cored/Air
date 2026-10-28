package org.airchord.backend.metrics;

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

import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 在独立 schema 验证并发点赞、浏览重试和 Consumer 重投后的最终计数。 */
@EnabledIfEnvironmentVariable(named = "AIRCHORD_TEST_JDBC_URL", matches = ".+")
class ArticleMetricIntegrationTest {
    @Test
    void httpJdbcInstrumentationPreservesTransactionsAndMeasuresThreeRequestLeases() {
        String url = System.getenv("AIRCHORD_TEST_JDBC_URL");
        String user = System.getenv("AIRCHORD_TEST_DB_USER");
        String password = System.getenv("AIRCHORD_TEST_DB_PASSWORD");
        var adminJdbc = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        String schema = "metric_http_test_" + UUID.randomUUID().toString().replace("-", "");
        adminJdbc.execute("CREATE SCHEMA " + schema);
        try {
            var rawSource = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?")
                    + "currentSchema=" + schema, user, password);
            var source = new ArticleMetricPerfDataSource(rawSource);
            Flyway.configure().dataSource(source).defaultSchema(schema)
                    .locations("classpath:db/migration", "classpath:db/fixtures").load().migrate();
            var jdbc = JdbcClient.create(source);
            var factory = new ProxyFactory(new ArticleMetricRepository(jdbc, new JdbcTemplate(source), true));
            factory.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(source),
                    new AnnotationTransactionAttributeSource()));
            var repository = (ArticleMetricRepository) factory.getProxy();
            ArticleMetricTiming.begin(true);
            assertThat(jdbc.sql("SELECT id FROM users WHERE id=1002").query(Long.class).single()).isEqualTo(1002L);
            String article = repository.publishedArticleId("learning-spring");
            assertThat(repository.recordView(article, UUID.randomUUID(), 1002L)).isTrue();
            var sample = ArticleMetricTiming.current();
            assertThat(sample.borrowed).isEqualTo(3);
            assertThat(sample.closed).isEqualTo(3);
            assertThat(sample.accountLoans).isEqualTo(1);
            assertThat(sample.articleLoans).isEqualTo(1);
            assertThat(sample.writeLoans).isEqualTo(1);
            assertThat(sample.sqlCalls).isEqualTo(4);
            assertThat(sample.commitCalls).isEqualTo(1);
            assertThat(sample.jdbcCommit).isPositive();
            assertThat(sample.holdWrite).isPositive();
            ArticleMetricTiming.clear();
            assertThat(jdbc.sql("SELECT count(*) FROM article_view_events").query(Long.class).single()).isEqualTo(1);
            jdbc.sql("ALTER TABLE article_metric_outbox ADD CONSTRAINT reject_http_test CHECK (delta=-1) NOT VALID").update();
            ArticleMetricTiming.begin(true);
            assertThatThrownBy(() -> repository.recordView(article, UUID.randomUUID(), null))
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
            var failed = ArticleMetricTiming.current();
            assertThat(failed.sqlFailures).isEqualTo(1);
            assertThat(failed.rollbackCalls).isEqualTo(1);
            assertThat(failed.commitCalls).isZero();
            assertThat(failed.closed).isEqualTo(1);
            ArticleMetricTiming.clear();
            assertThat(jdbc.sql("SELECT count(*) FROM article_view_events").query(Long.class).single()).isEqualTo(1);
        } finally {
            ArticleMetricTiming.clear();
            adminJdbc.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }

    @Test
    void consumerBatchRollsBackAllArticlesThenRetriesAndDeduplicates() throws Exception {
        String url = System.getenv("AIRCHORD_TEST_JDBC_URL");
        String user = System.getenv("AIRCHORD_TEST_DB_USER");
        String password = System.getenv("AIRCHORD_TEST_DB_PASSWORD");
        var adminJdbc = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        String schema = "metric_consumer_batch_test_" + UUID.randomUUID().toString().replace("-", "");
        adminJdbc.execute("CREATE SCHEMA " + schema);
        try {
            var source = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?")
                    + "currentSchema=" + schema, user, password);
            Flyway.configure().dataSource(source).defaultSchema(schema)
                    .locations("classpath:db/migration", "classpath:db/fixtures").load().migrate();
            var jdbc = JdbcClient.create(source);
            var factory = new ProxyFactory(new ArticleMetricRepository(jdbc, new JdbcTemplate(source), true));
            factory.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(source),
                    new AnnotationTransactionAttributeSource()));
            var repository = (ArticleMetricRepository) factory.getProxy();
            var articles = jdbc.sql("SELECT id FROM content_items WHERE content_type='ARTICLE' ORDER BY id LIMIT 2")
                    .query(String.class).list();
            String first = articles.getFirst(), second = articles.getLast();
            for (int i = 0; i < 5; i++) repository.recordView(first, UUID.randomUUID(), null);
            for (int i = 0; i < 3; i++) repository.recordView(second, UUID.randomUUID(), null);
            repository.like(first, 1002L);
            repository.unlike(first, 1002L);
            repository.like(first, 1002L);
            var events = repository.claimOutbox(100);
            var existing = events.stream().filter(e -> e.articleId().equals(first) && e.metricType().equals("VIEW"))
                    .findFirst().orElseThrow();
            assertThat(repository.applyBatch(List.of(existing)).eventIds()).containsExactly(existing.id());
            // 第二篇文章统计失败，验证第一篇的更新与所有新防重标记也一起回滚。
            jdbc.sql("ALTER TABLE article_stats ADD CONSTRAINT reject_test_stats CHECK (article_id <> '"
                    + second + "' OR view_count = 0)").update();
            var cache = org.mockito.Mockito.mock(ArticleStatsCache.class);
            var channel = org.mockito.Mockito.mock(com.rabbitmq.client.Channel.class);
            var consumer = new ArticleMetricConsumer(repository, cache, true);
            var messages = new java.util.ArrayList<org.springframework.amqp.core.Message>();
            var reversed = new java.util.ArrayList<>(events);
            java.util.Collections.reverse(reversed);
            reversed.add(existing); // 同批重复消息，加上先前已提交事件。
            long tag = 1;
            for (var event : reversed) {
                var message = new org.springframework.amqp.core.Message(("{\"version\":1,\"eventId\":\""
                        + event.id() + "\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8));
                message.getMessageProperties().setDeliveryTag(tag++);
                messages.add(message);
            }
            ArticleMetricConsumerTiming.drain(Integer.MAX_VALUE);
            consumer.consume(messages, channel);
            org.mockito.Mockito.verifyNoInteractions(cache);
            org.mockito.Mockito.verify(channel, org.mockito.Mockito.times(messages.size()))
                    .basicNack(org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.eq(false),
                            org.mockito.ArgumentMatchers.eq(true));
            assertThat(repository.counts(first).viewCount()).isEqualTo(1);
            assertThat(repository.counts(second).viewCount()).isZero();
            assertThat(jdbc.sql("SELECT count(*) FROM article_metric_processed").query(Long.class).single()).isEqualTo(1);
            assertThat(ArticleMetricConsumerTiming.drain(100).getFirst())
                    .containsEntry("transactionCompletion", "ROLLED_BACK").containsEntry("commitSamples", 0);
            jdbc.sql("ALTER TABLE article_stats DROP CONSTRAINT reject_test_stats").update();
            // 失效缓存与 ACK 发生时，从其他连接已能看到整批提交。
            org.mockito.Mockito.doAnswer(call -> {
                assertThat(org.springframework.transaction.support.TransactionSynchronizationManager
                        .isActualTransactionActive()).isFalse();
                assertThat(repository.counts(first).viewCount()).isEqualTo(5);
                assertThat(repository.counts(first).likeCount()).isEqualTo(1);
                assertThat(repository.counts(second).viewCount()).isEqualTo(3);
                return null;
            }).when(cache).evictBatch(org.mockito.ArgumentMatchers.anyCollection());
            consumer.consume(messages, channel);
            var applied = ArticleMetricConsumerTiming.drain(100).getFirst();
            assertThat(applied).containsEntry("commitSamples", 1).containsEntry("transactionCompletion", "COMMITTED")
                    .containsEntry("applied", 10).containsEntry("duplicate", 2).containsEntry("cacheArticles", 2);
            assertThat(jdbc.sql("SELECT count(*) FROM article_metric_processed").query(Long.class).single()).isEqualTo(11);
            org.mockito.Mockito.verify(cache).evictBatch(List.of(first, second));
            assertThat(applied).containsEntry("statsSqlCalls", 1);
            org.mockito.Mockito.verify(channel, org.mockito.Mockito.times(messages.size()))
                    .basicAck(org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.eq(false));
            consumer.consume(messages, channel);
            assertThat(ArticleMetricConsumerTiming.drain(100).getFirst()).containsEntry("applied", 0)
                    .containsEntry("duplicate", 12).containsEntry("statsSqlMs", 0.0).containsEntry("cacheArticles", 0);
            org.mockito.Mockito.verify(cache, org.mockito.Mockito.times(1)).evictBatch(org.mockito.ArgumentMatchers.anyCollection());
            assertThat(repository.counts(first).viewCount()).isEqualTo(5);
            assertThat(repository.counts(second).viewCount()).isEqualTo(3);
        } finally { adminJdbc.execute("DROP SCHEMA " + schema + " CASCADE"); }
    }

    @Test
    void bulkStatsPreservesViewOnlyLikesAndRebuildsReorderedLikeFacts() {
        String url = System.getenv("AIRCHORD_TEST_JDBC_URL");
        String user = System.getenv("AIRCHORD_TEST_DB_USER");
        String password = System.getenv("AIRCHORD_TEST_DB_PASSWORD");
        var adminJdbc = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        String schema = "metric_bulk_test_" + UUID.randomUUID().toString().replace("-", "");
        adminJdbc.execute("CREATE SCHEMA " + schema);
        try {
            var source = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?")
                    + "currentSchema=" + schema, user, password);
            Flyway.configure().dataSource(source).defaultSchema(schema)
                    .locations("classpath:db/migration", "classpath:db/fixtures").load().migrate();
            var jdbc = JdbcClient.create(source);
            var factory = new ProxyFactory(new ArticleMetricRepository(jdbc, new JdbcTemplate(source), true));
            factory.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(source),
                    new AnnotationTransactionAttributeSource()));
            var repository = (ArticleMetricRepository) factory.getProxy();
            var articles = jdbc.sql("SELECT id FROM content_items WHERE content_type='ARTICLE' ORDER BY id LIMIT 2")
                    .query(String.class).list();
            String first = articles.getFirst(), second = articles.getLast();
            repository.like(first, 1002L);
            var initial = repository.claimOutbox(100);
            repository.applyBatch(initial);
            repository.markPublishedBatch(initial.stream().map(ArticleMetricRepository.Event::id).toList());
            assertThat(repository.counts(first).likeCount()).isEqualTo(1);

            for (int i = 0; i < 2; i++) repository.recordView(first, UUID.randomUUID(), null);
            for (int i = 0; i < 3; i++) repository.recordView(second, UUID.randomUUID(), null);
            repository.like(second, 1002L);
            repository.unlike(second, 1002L);
            var events = new java.util.ArrayList<>(repository.claimOutbox(100));
            java.util.Collections.reverse(events);
            events.add(events.getFirst());
            assertThat(repository.applyBatch(events).eventIds()).hasSize(7);
            assertThat(repository.counts(first).viewCount()).isEqualTo(2);
            assertThat(repository.counts(first).likeCount()).isEqualTo(1); // 纯 VIEW 保留原点赞数。
            assertThat(repository.counts(second).viewCount()).isEqualTo(3);
            assertThat(repository.counts(second).likeCount()).isZero(); // 新统计行与取消赞。
            repository.markPublishedBatch(events.stream().map(ArticleMetricRepository.Event::id).distinct().toList());

            repository.unlike(first, 1002L);
            repository.like(first, 1002L);
            repository.unlike(first, 1002L);
            repository.like(second, 1002L);
            repository.recordView(first, UUID.randomUUID(), null);
            var next = new java.util.ArrayList<>(repository.claimOutbox(100));
            java.util.Collections.reverse(next);
            assertThat(repository.applyBatch(next).eventIds()).hasSize(5);
            assertThat(repository.counts(first).viewCount()).isEqualTo(3);
            assertThat(repository.counts(first).likeCount()).isZero();
            assertThat(repository.counts(second).viewCount()).isEqualTo(3);
            assertThat(repository.counts(second).likeCount()).isEqualTo(1);
            var timing = ArticleMetricConsumerTiming.begin(true);
            try { assertThat(repository.applyBatch(next).eventIds()).isEmpty(); }
            finally { ArticleMetricConsumerTiming.finish(timing); }
            assertThat(ArticleMetricConsumerTiming.drain(100).getLast())
                    .containsEntry("statsSqlCalls", 0).containsEntry("statsSqlMs", 0.0);
            assertThat(repository.applyBatch(List.of()).articleIds()).isEmpty();
            assertThat(jdbc.sql("SELECT count(*) FROM article_metric_processed").query(Long.class).single()).isEqualTo(13);
        } finally {
            ArticleMetricConsumerTiming.drain(Integer.MAX_VALUE);
            adminJdbc.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }

    @Test
    void batchPublishedMarkIsAtomicIdempotentAndExpiredLeaseCanRetry() {
        String url = System.getenv("AIRCHORD_TEST_JDBC_URL");
        String user = System.getenv("AIRCHORD_TEST_DB_USER");
        String password = System.getenv("AIRCHORD_TEST_DB_PASSWORD");
        var adminJdbc = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        String schema = "metric_batch_test_" + UUID.randomUUID().toString().replace("-", "");
        adminJdbc.execute("CREATE SCHEMA " + schema);
        try {
            var source = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?")
                    + "currentSchema=" + schema, user, password);
            Flyway.configure().dataSource(source).defaultSchema(schema)
                    .locations("classpath:db/migration", "classpath:db/fixtures").load().migrate();
            var jdbc = JdbcClient.create(source);
            var factory = new ProxyFactory(new ArticleMetricRepository(jdbc, new JdbcTemplate(source), true));
            factory.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(source),
                    new AnnotationTransactionAttributeSource()));
            var repository = (ArticleMetricRepository) factory.getProxy();
            String articleId = repository.publishedArticleId("learning-spring");
            for (int i = 0; i < 4; i++) {
                repository.recordView(articleId, UUID.randomUUID(), null);
            }
            var events = repository.claimOutbox(200);
            var success = List.of(events.get(0).id(), events.get(1).id());
            assertThat(repository.markPublishedBatch(success)).isEqualTo(2);
            assertThat(repository.markPublishedBatch(success)).isZero();
            assertThat(repository.markPublishedBatch(List.of())).isZero();
            assertThat(jdbc.sql("SELECT count(*) FROM article_metric_outbox WHERE published_at IS NOT NULL AND claimed_until IS NULL")
                    .query(Long.class).single()).isEqualTo(2);
            assertThat(jdbc.sql("SELECT count(*) FROM article_metric_outbox WHERE published_at IS NULL AND claimed_until IS NOT NULL")
                    .query(Long.class).single()).isEqualTo(2);

            // 让其中一行拒绝发布标记：同一 UPDATE 中其他行也不能部分成功。
            jdbc.sql("ALTER TABLE article_metric_outbox ADD CONSTRAINT reject_test_mark CHECK (published_at IS NULL OR id <> '"
                    + events.get(3).id() + "'::uuid)").update();
            var pending = List.of(events.get(2).id(), events.get(3).id());
            assertThatThrownBy(() -> repository.markPublishedBatch(pending))
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
            assertThat(jdbc.sql("SELECT count(*) FROM article_metric_outbox WHERE published_at IS NULL AND claimed_until IS NOT NULL")
                    .query(Long.class).single()).isEqualTo(2);
            assertThat(repository.claimOutbox(200)).isEmpty();

            // 模拟原租约到期，验证可重新领取，并用 Consumer 幂等处理重复投递。
            jdbc.sql("ALTER TABLE article_metric_outbox DROP CONSTRAINT reject_test_mark").update();
            jdbc.sql("UPDATE article_metric_outbox SET claimed_until = now() - interval '1 second' WHERE published_at IS NULL").update();
            var retried = repository.claimOutbox(200);
            assertThat(retried.stream().map(ArticleMetricRepository.Event::id).toList())
                    .containsExactlyInAnyOrderElementsOf(pending);
            ArticleMetricConsumerTiming.drain(Integer.MAX_VALUE);
            for (var event : retried) {
                var applied = ArticleMetricConsumerTiming.begin(true);
                try { assertThat(repository.apply(event)).isTrue(); }
                finally { ArticleMetricConsumerTiming.finish(applied); }
                var appliedSample = ArticleMetricConsumerTiming.drain(100).getFirst();
                assertThat(appliedSample).containsEntry("transactionCompletion", "COMMITTED")
                        .containsEntry("commitSamples", 1);
                assertThat((Double) appliedSample.get("commitApproxMs")).isPositive();
                assertThat((Double) appliedSample.get("processedSqlMs")).isPositive();
                assertThat((Double) appliedSample.get("statsSqlMs")).isPositive();

                var duplicate = ArticleMetricConsumerTiming.begin(true);
                try { assertThat(repository.apply(event)).isFalse(); }
                finally { ArticleMetricConsumerTiming.finish(duplicate); }
                assertThat(ArticleMetricConsumerTiming.drain(100).getFirst())
                        .containsEntry("transactionCompletion", "COMMITTED")
                        .containsEntry("commitSamples", 1).containsEntry("statsSqlMs", 0.0);
            }
            var invalidEvent = new ArticleMetricRepository.Event(UUID.randomUUID(), "missing-article", "VIEW", 1);
            var rollback = ArticleMetricConsumerTiming.begin(true);
            try { assertThatThrownBy(() -> repository.apply(invalidEvent))
                    .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class); }
            finally { ArticleMetricConsumerTiming.finish(rollback); }
            assertThat(ArticleMetricConsumerTiming.drain(100).getFirst())
                    .containsEntry("transactionCompletion", "ROLLED_BACK").containsEntry("commitSamples", 0);
            assertThat(jdbc.sql("SELECT count(*) FROM article_metric_processed WHERE event_id=:id")
                    .param("id", invalidEvent.id()).query(Long.class).single()).isZero();
            assertThat(repository.markPublishedBatch(pending)).isEqualTo(2);
            assertThat(repository.counts(articleId).viewCount()).isEqualTo(2);
            assertThat(jdbc.sql("SELECT count(*) FROM article_metric_outbox WHERE published_at IS NULL")
                    .query(Long.class).single()).isZero();
        } finally {
            adminJdbc.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }

    @Test
    void factsAndOutboxAreIdempotentAndRedeliveryDoesNotDoubleCount() throws Exception {
        String url = System.getenv("AIRCHORD_TEST_JDBC_URL");
        String user = System.getenv("AIRCHORD_TEST_DB_USER");
        String password = System.getenv("AIRCHORD_TEST_DB_PASSWORD");
        var adminJdbc = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        String schema = "metric_test_" + UUID.randomUUID().toString().replace("-", "");
        adminJdbc.execute("CREATE SCHEMA " + schema);
        try {
            var source = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?")
                    + "currentSchema=" + schema, user, password);
            Flyway.configure().dataSource(source).defaultSchema(schema)
                    .locations("classpath:db/migration", "classpath:db/fixtures").load().migrate();
            var jdbc = JdbcClient.create(source);
            var repository = new ArticleMetricRepository(jdbc, new JdbcTemplate(source), true);
            String articleId = repository.publishedArticleId("learning-spring");
            assertThatThrownBy(() -> repository.publishedArticleId("draft-reference"))
                    .isInstanceOf(org.airchord.backend.web.ContentNotFoundException.class);

            UUID viewId = UUID.randomUUID();
            assertThat(repository.recordView(articleId, viewId, 1002L)).isTrue();
            assertThat(repository.recordView(articleId, viewId, 1002L)).isFalse();

            // 同一用户并发点击 100 次，数据库唯一键只能接受其中一次。
            try (var executor = Executors.newFixedThreadPool(20)) {
                var tasks = java.util.stream.IntStream.range(0, 100)
                        .<java.util.concurrent.Callable<Boolean>>mapToObj(i -> () -> repository.like(articleId, 1002L))
                        .toList();
                long accepted = executor.invokeAll(tasks).stream().filter(future -> {
                    try { return future.get(); } catch (Exception ex) { throw new RuntimeException(ex); }
                }).count();
                assertThat(accepted).isEqualTo(1);
            }
            assertThat(repository.likedBy(articleId, 1002L)).isTrue();
            assertThat(repository.unlike(articleId, 1002L)).isTrue();
            assertThat(repository.unlike(articleId, 1002L)).isFalse();
            assertThat(repository.like(articleId, 1002L)).isTrue();

            var events = repository.claimOutbox(20);
            assertThat(events).hasSize(4);
            // 特意逆序处理取消赞与点赞；点赞统计仍从真实关系重建。
            for (int i = events.size() - 1; i >= 0; i--) {
                var event = events.get(i);
                assertThat(repository.apply(event)).isTrue();
                assertThat(repository.apply(event)).isFalse();
            }
            assertThat(repository.counts(articleId).viewCount()).isEqualTo(1);
            assertThat(repository.counts(articleId).likeCount()).isEqualTo(1);
            assertThat(jdbc.sql("SELECT count(*) FROM article_likes").query(Long.class).single()).isEqualTo(1);
            assertThat(jdbc.sql("SELECT count(*) FROM article_view_events").query(Long.class).single()).isEqualTo(1);
            assertThat(jdbc.sql("SELECT count(*) FROM article_metric_processed").query(Long.class).single()).isEqualTo(4);
        } finally {
            adminJdbc.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }
}

