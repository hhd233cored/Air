package org.airchord.backend.content;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;

/**
 * 公开详情的 Redis Cache-Aside 实现。
 *
 * Redis 只作为可丢弃缓存：连接失败时回源 PostgreSQL，SQL 结果仍是事实来源。
 */
@Component
public class PublicContentCache {

    private static final System.Logger LOGGER = System.getLogger(PublicContentCache.class.getName());
    private static final String KEY_PREFIX = "airchord:cache:v1:public:";
    private static final JsonMapper JSON_MAPPER = JsonMapper.builder().build();

    // 只释放自己持有的锁，避免租期过后误删其他请求新拿到的锁。
    private static final DefaultRedisScript<Long> RELEASE_LOCK_SCRIPT = new DefaultRedisScript<>("""
            if redis.call('get', KEYS[1]) == ARGV[1] then
                return redis.call('del', KEYS[1])
            end
            return 0
            """, Long.class);

    private final StringRedisTemplate redis;
    private final Duration ttl;
    private final Duration ttlJitter;
    private final Duration lockTtl;
    private final Duration lockWait;
    private final Duration lockPoll;

    public PublicContentCache(
            StringRedisTemplate redis,
            @Value("${airchord.cache.public-content.ttl:5m}") Duration ttl,
            @Value("${airchord.cache.public-content.ttl-jitter:30s}") Duration ttlJitter,
            @Value("${airchord.cache.public-content.lock-ttl:10s}") Duration lockTtl,
            @Value("${airchord.cache.public-content.lock-wait:2s}") Duration lockWait,
            @Value("${airchord.cache.public-content.lock-poll:50ms}") Duration lockPoll
    ) {
        this.redis = redis;
        this.ttl = ttl;
        this.ttlJitter = ttlJitter;
        this.lockTtl = lockTtl;
        this.lockWait = lockWait;
        this.lockPoll = lockPoll;
    }

    public ArticleDetail getArticle(String slug, Supplier<ArticleDetail> loader) {
        return getOrLoad(key("article", slug), ArticleDetail.class, loader);
    }

    public ChatterDetail getChatter(String slug, Supplier<ChatterDetail> loader) {
        return getOrLoad(key("chatter", slug), ChatterDetail.class, loader);
    }

    /**
     * 在数据库事务提交后由失效监听器调用。slug 列表允许以后一次变更同时清理旧、新 slug。
     */
    public void evict(String contentType, List<String> slugs) {
        if (!"ARTICLE".equals(contentType) && !"CHATTER".equals(contentType)) {
            LOGGER.log(System.Logger.Level.WARNING, "忽略未知类型的公开缓存失效事件: {0}", contentType);
            return;
        }
        for (String slug : slugs) {
            if (slug == null || slug.isBlank()) continue;
            try {
                redis.delete(key(contentType.toLowerCase(Locale.ROOT), slug));
            } catch (DataAccessException exception) {
                // SQL 已提交，缓存删除失败时由 TTL 限制旧值存活时间，并记录日志供后续排查。
                LOGGER.log(System.Logger.Level.ERROR, "Redis 缓存失效失败，内容类型=" + contentType + "，slug=" + slug, exception);
            }
        }
    }

    private <T> T getOrLoad(String cacheKey, Class<T> responseType, Supplier<T> loader) {
        CacheLookup<T> initial = read(cacheKey, responseType);
        if (initial.value() != null) return initial.value();
        if (!initial.redisAvailable()) return loadWithoutCache(loader);

        String lockKey = cacheKey + ":load-lock";
        String token = UUID.randomUUID().toString();
        final Boolean acquired;
        try {
            // SET key token NX PX：只让一个请求成为该 key 的回源者，并让锁自动过期。
            acquired = redis.opsForValue().setIfAbsent(lockKey, token, lockTtl);
        } catch (DataAccessException exception) {
            LOGGER.log(System.Logger.Level.WARNING, "Redis 锁不可用，直接回源 PostgreSQL", exception);
            return loadWithoutCache(loader);
        }

        if (Boolean.TRUE.equals(acquired)) {
            try {
                // 等待锁期间缓存可能已被别的请求填好，所以拿锁后要再次检查。
                CacheLookup<T> second = read(cacheKey, responseType);
                if (second.value() != null) return second.value();
                if (!second.redisAvailable()) return loadWithoutCache(loader);

                T loaded = loader.get();
                if (loaded != null) write(cacheKey, loaded);
                return loaded;
            } finally {
                releaseLock(lockKey, token);
            }
        }

        // 其他请求已在回源；短暂等待其填充缓存，超时后本请求直接查数据库，避免无限等待。
        T cached = waitForCache(cacheKey, responseType);
        return cached != null ? cached : loadWithoutCache(loader);
    }

    private <T> CacheLookup<T> read(String cacheKey, Class<T> responseType) {
        final String json;
        try {
            json = redis.opsForValue().get(cacheKey);
        } catch (DataAccessException exception) {
            LOGGER.log(System.Logger.Level.WARNING, "Redis 读取失败，回退 PostgreSQL", exception);
            return new CacheLookup<>(null, false);
        }
        if (json == null) return new CacheLookup<>(null, true);

        try {
            return new CacheLookup<>(JSON_MAPPER.readValue(json, responseType), true);
        } catch (Exception exception) {
            // 旧版本或损坏的 JSON 不应让公开接口持续失败；删除坏值并按 miss 处理。
            LOGGER.log(System.Logger.Level.WARNING, "Redis 缓存格式无法读取，按 miss 处理: " + cacheKey, exception);
            try {
                redis.delete(cacheKey);
            } catch (DataAccessException deleteException) {
                LOGGER.log(System.Logger.Level.WARNING, "无法删除损坏的 Redis 缓存: " + cacheKey, deleteException);
            }
            return new CacheLookup<>(null, true);
        }
    }

    private <T> void write(String cacheKey, T value) {
        try {
            String json = JSON_MAPPER.writeValueAsString(value);
            long jitterBound = Math.max(0, ttlJitter.toMillis());
            long jitter = jitterBound == 0 ? 0 : ThreadLocalRandom.current().nextLong(jitterBound + 1);
            // TTL = 基础时长 + 有界随机值；当前默认最多缓存 5 分 30 秒。
            redis.opsForValue().set(cacheKey, json, Duration.ofMillis(ttl.toMillis() + jitter));
        } catch (DataAccessException exception) {
            LOGGER.log(System.Logger.Level.WARNING, "Redis 写入失败，仍返回 PostgreSQL 结果", exception);
        } catch (Exception exception) {
            LOGGER.log(System.Logger.Level.ERROR, "公开 DTO 无法序列化为 Redis 缓存: " + cacheKey, exception);
        }
    }

    private <T> T waitForCache(String cacheKey, Class<T> responseType) {
        long deadline = System.nanoTime() + Math.max(0, lockWait.toNanos());
        long pollMillis = Math.max(1, lockPoll.toMillis());
        while (System.nanoTime() < deadline) {
            try {
                Thread.sleep(pollMillis);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                return null;
            }
            CacheLookup<T> lookup = read(cacheKey, responseType);
            if (lookup.value() != null) return lookup.value();
            if (!lookup.redisAvailable()) return null;
        }
        return null;
    }

    private void releaseLock(String lockKey, String token) {
        try {
            redis.execute(RELEASE_LOCK_SCRIPT, List.of(lockKey), token);
        } catch (DataAccessException exception) {
            // 即使 Redis 短暂不可用，锁也会在 lockTtl 后自动释放。
            LOGGER.log(System.Logger.Level.WARNING, "Redis 回源锁释放失败，将等待锁自动过期: " + lockKey, exception);
        }
    }

    private static <T> T loadWithoutCache(Supplier<T> loader) {
        return loader.get();
    }

    private static String key(String contentType, String slug) {
        return KEY_PREFIX + contentType + ":" + slug.strip().toLowerCase(Locale.ROOT);
    }

    private record CacheLookup<T>(T value, boolean redisAvailable) {
    }
}
