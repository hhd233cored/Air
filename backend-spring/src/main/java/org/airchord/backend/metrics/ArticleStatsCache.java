package org.airchord.backend.metrics;

import org.airchord.backend.metrics.ArticleMetricRepository.Counts;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;

/** Redis 只保存公开计数的短期快照；故障时直接读取 PostgreSQL。 */
@Component
public class ArticleStatsCache {
    private static final System.Logger LOG = System.getLogger(ArticleStatsCache.class.getName());
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final StringRedisTemplate redis;

    public ArticleStatsCache(StringRedisTemplate redis) { this.redis = redis; }

    public Counts get(String articleId, Supplier<Counts> loader) {
        String key = key(articleId);
        try {
            String raw = redis.opsForValue().get(key);
            if (raw != null) return JSON.readValue(raw, Counts.class);
        } catch (DataAccessException ex) {
            LOG.log(System.Logger.Level.WARNING, "文章统计缓存不可用，回源 PostgreSQL", ex);
            return loader.get();
        } catch (Exception ex) {
            LOG.log(System.Logger.Level.WARNING, "文章统计缓存损坏，重新读取 PostgreSQL", ex);
        }
        Counts counts = loader.get();
        try {
            // 30–35 秒短 TTL 减少高频失效和进程中断后的陈旧时间。
            redis.opsForValue().set(key, JSON.writeValueAsString(counts),
                    Duration.ofSeconds(30 + ThreadLocalRandom.current().nextInt(6)));
        } catch (Exception ex) {
            LOG.log(System.Logger.Level.WARNING, "文章统计缓存写入失败，已返回 PostgreSQL 结果", ex);
        }
        return counts;
    }

    public void evict(String articleId) {
        evictBatch(List.of(articleId));
    }

    /** 提交后一次删除本批涉及的唯一键；Redis 故障仍依靠短 TTL 结束旧快照。 */
    public void evictBatch(Collection<String> articleIds) {
        var keys = articleIds.stream().distinct().map(ArticleStatsCache::key).toList();
        if (keys.isEmpty()) return;
        ArticleMetricConsumerTiming.cacheDeleteCall();
        try { redis.delete(keys); }
        catch (DataAccessException ex) {
            ArticleMetricConsumerTiming.cacheEvictionFailed(keys.size());
            // 数据库已经提交；即使删除失败，短 TTL 也会结束旧快照。
            LOG.log(System.Logger.Level.ERROR, "文章统计批量缓存失效失败，涉及文章数: " + keys.size(), ex);
        }
    }

    private static String key(String articleId) { return "airchord:cache:v1:article-stats:" + articleId; }
}
