package org.airchord.backend.metrics;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class ArticleStatsCacheTest {
    @Test
    void deletesDistinctKeysInOneCallAndDoesNotTouchOtherKeys() {
        var redis = mock(StringRedisTemplate.class);
        new ArticleStatsCache(redis).evictBatch(List.of("first", "second", "first"));
        verify(redis).delete(List.of("airchord:cache:v1:article-stats:first",
                "airchord:cache:v1:article-stats:second"));
        verifyNoMoreInteractions(redis);
    }

    @Test
    void emptyBatchDoesNotCallRedis() {
        var redis = mock(StringRedisTemplate.class);
        new ArticleStatsCache(redis).evictBatch(List.of());
        verifyNoInteractions(redis);
    }

    @Test
    void unavailableRedisRecordsOneFailedCallAndAllAffectedArticles() {
        var redis = mock(StringRedisTemplate.class);
        when(redis.delete(anyCollection())).thenThrow(new RedisConnectionFailureException("unavailable"));
        var timing = ArticleMetricConsumerTiming.begin(true);
        try { new ArticleStatsCache(redis).evictBatch(List.of("first", "second", "first")); }
        finally { ArticleMetricConsumerTiming.finish(timing); }
        assertThat(ArticleMetricConsumerTiming.drain(100).getLast())
                .containsEntry("cacheDeleteCalls", 1).containsEntry("cacheEvictionFailures", 1)
                .containsEntry("cacheEvictionFailedArticles", 2);
    }
}
