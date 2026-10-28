package org.airchord.backend.metrics;

import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.metrics.IMetricsTracker;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;

/** 压测专用：从 Hikari 借出连接的回调记录真实取连接耗时。 */
@Component
@ConditionalOnProperty(name = "airchord.perf-timing-enabled", havingValue = "true")
public class ArticleMetricPerfConnectionMetrics implements BeanPostProcessor {
    private final boolean jdbcTiming;
    private final int backgroundSize;
    public ArticleMetricPerfConnectionMetrics(@Value("${airchord.perf-jdbc-enabled:false}") boolean jdbcTiming,
            @Value("${airchord.perf-background-pool-size:0}") int backgroundSize) {
        this.jdbcTiming = jdbcTiming;
        this.backgroundSize = backgroundSize;
    }
    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        if (bean instanceof HikariDataSource hikari) {
            hikari.setMetricsTrackerFactory((poolName, poolStats) -> new IMetricsTracker() {
                @Override
                public void recordConnectionAcquiredNanos(long nanos) {
                    ArticleMetricTiming.connectionAcquire(nanos);
                    ArticleMetricPublisherTiming.connectionAcquire(nanos);
                    ArticleMetricConsumerTiming.connectionAcquire(nanos);
                }
            });
        }
        return bean;
    }

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        if (!(bean instanceof HikariDataSource hikari)) return bean;
        if (backgroundSize == 0) return jdbcTiming ? new ArticleMetricPerfDataSource(hikari) : bean;
        if (backgroundSize < 0 || backgroundSize >= hikari.getMaximumPoolSize())
            throw new IllegalArgumentException("Background pool must leave at least one HTTP connection");
        if (hikari.getHikariPoolMXBean() != null)
            throw new IllegalStateException("Split budget must be configured before the pool starts");
        int total = hikari.getMaximumPoolSize();
        var background = new HikariDataSource();
        hikari.copyStateTo(background);
        background.setPoolName("article-background");
        background.setMaximumPoolSize(backgroundSize);
        background.setMinimumIdle(backgroundSize);
        hikari.setPoolName("article-http");
        hikari.setMaximumPoolSize(total - backgroundSize);
        hikari.setMinimumIdle(total - backgroundSize);
        return new ArticleMetricSplitDataSource(jdbcTiming ? new ArticleMetricPerfDataSource(hikari) : hikari,
                jdbcTiming ? new ArticleMetricPerfDataSource(background) : background, background);
    }
}
