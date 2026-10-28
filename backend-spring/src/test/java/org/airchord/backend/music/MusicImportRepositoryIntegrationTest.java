package org.airchord.backend.music;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 随机 schema 验证 Flyway、容量锁、任务状态和 outbox；不碰现有业务数据。 */
@EnabledIfEnvironmentVariable(named = "AIRCHORD_TEST_JDBC_URL", matches = ".+")
class MusicImportRepositoryIntegrationTest {
    @Test
    void migrationCapacityAndOutboxStayConsistent() throws Exception {
        String url = System.getenv("AIRCHORD_TEST_JDBC_URL");
        String user = System.getenv("AIRCHORD_TEST_DB_USER");
        String password = System.getenv("AIRCHORD_TEST_DB_PASSWORD");
        var admin = new DriverManagerDataSource(url, user, password);
        var adminJdbc = new JdbcTemplate(admin);
        String schema = "music_import_test_" + UUID.randomUUID().toString().replace("-", "");
        adminJdbc.execute("CREATE SCHEMA " + schema);
        try {
            var source = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?")
                    + "currentSchema=" + schema, user, password);
            Flyway.configure().dataSource(source).defaultSchema(schema)
                    .locations("classpath:db/migration", "classpath:db/fixtures").load().migrate();
            var jdbc = JdbcClient.create(source);
            var transaction = new TransactionTemplate(new DataSourceTransactionManager(source));
            var repository = new MusicImportRepository(jdbc, 1, 10);
            long actorId = jdbc.sql("SELECT id FROM users ORDER BY id LIMIT 1").query(Long.class).single();
            UUID id = UUID.randomUUID();

            var accepted = transaction.execute(status -> repository.enqueue(id,
                    "song-" + id.toString().replace("-", ""), actorId, "sample.mp3", 5));
            assertThat(accepted.status()).isEqualTo("PENDING");
            assertThat(repository.claimOutbox()).hasSize(1);
            assertThatThrownBy(() -> transaction.execute(status -> repository.enqueue(UUID.randomUUID(),
                    "song-" + UUID.randomUUID().toString().replace("-", ""), actorId, "other.mp3", 1)))
                    .isInstanceOf(MusicImportCapacityException.class);
            assertThat(repository.claimJob(id).status()).isEqualTo("RUNNING");
            repository.succeed(id);
            assertThat(repository.find(id).status()).isEqualTo("SUCCEEDED");
            assertThat(repository.claimJob(id)).isNull();
            UUID next = UUID.randomUUID();
            assertThat(transaction.execute(status -> repository.enqueue(next,
                    "song-" + next.toString().replace("-", ""), actorId, "next.mp3", 5)).status())
                    .isEqualTo("PENDING");

            repository.claimJob(next);
            repository.succeed(next);
            // 两个请求同时通过容量检查时，数据库事务锁仍只能允许其中一个入队。
            try (var workers = Executors.newFixedThreadPool(2)) {
                var start = new CountDownLatch(1);
                Future<Boolean> first = workers.submit(() -> enqueueAfterSignal(start, transaction, repository, actorId));
                Future<Boolean> second = workers.submit(() -> enqueueAfterSignal(start, transaction, repository, actorId));
                start.countDown();
                assertThat(first.get()).isNotEqualTo(second.get());
            }
            assertThat(jdbc.sql("SELECT count(*) FROM music_import_jobs WHERE status IN ('PENDING', 'RUNNING')")
                    .query(Long.class).single()).isEqualTo(1);
        } finally {
            adminJdbc.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }

    private boolean enqueueAfterSignal(CountDownLatch start, TransactionTemplate transaction,
                                       MusicImportRepository repository, long actorId) throws InterruptedException {
        start.await();
        UUID id = UUID.randomUUID();
        try {
            transaction.execute(status -> repository.enqueue(id,
                    "song-" + id.toString().replace("-", ""), actorId, "parallel.mp3", 5));
            return true;
        } catch (MusicImportCapacityException expected) {
            return false;
        }
    }
}
