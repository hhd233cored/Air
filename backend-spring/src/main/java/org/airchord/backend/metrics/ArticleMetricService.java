package org.airchord.backend.metrics;

import org.airchord.backend.auth.AuthPrincipal;
import org.airchord.backend.metrics.ArticleMetricRepository.Counts;
import org.airchord.backend.web.ApiBadRequestException;
import org.springframework.stereotype.Service;

import java.util.UUID;

/** 校验公开文章并组合计数快照与当前用户的点赞关系。 */
@Service
public class ArticleMetricService {
    private final ArticleMetricRepository repository;
    private final ArticleStatsCache cache;

    public ArticleMetricService(ArticleMetricRepository repository, ArticleStatsCache cache) {
        this.repository = repository;
        this.cache = cache;
    }

    public StatsResponse stats(String slug, AuthPrincipal actor) {
        String articleId = repository.publishedArticleId(slug);
        Counts counts = cache.get(articleId, () -> repository.counts(articleId));
        boolean liked = actor != null && repository.likedBy(articleId, actor.id());
        return new StatsResponse(counts.viewCount(), counts.likeCount(), liked, counts.updatedAt());
    }

    public ViewResponse view(String slug, String idempotencyKey, AuthPrincipal actor) {
        long validationStart = System.nanoTime();
        if (idempotencyKey == null || idempotencyKey.isBlank())
            throw new ApiBadRequestException("VIEW_EVENT_ID_REQUIRED", "Idempotency-Key is required");
        UUID id;
        try { id = UUID.fromString(idempotencyKey.strip()); }
        catch (IllegalArgumentException ex) {
            throw new ApiBadRequestException("VIEW_EVENT_ID_INVALID", "Idempotency-Key must be a UUID");
        }
        ArticleMetricTiming.validation(System.nanoTime() - validationStart);
        long lookupStart = System.nanoTime();
        String articleId = repository.publishedArticleId(slug);
        ArticleMetricTiming.lookup(System.nanoTime() - lookupStart);
        long transactionStart = System.nanoTime();
        boolean changed = repository.recordView(articleId, id, actor == null ? null : actor.id());
        ArticleMetricTiming.transaction(System.nanoTime() - transactionStart);
        return new ViewResponse(id.toString(), changed);
    }

    public LikeResponse like(String slug, AuthPrincipal actor) {
        long lookupStart = System.nanoTime();
        String articleId = repository.publishedArticleId(slug);
        ArticleMetricTiming.lookup(System.nanoTime() - lookupStart);
        long transactionStart = System.nanoTime();
        boolean changed = repository.like(articleId, actor.id());
        ArticleMetricTiming.transaction(System.nanoTime() - transactionStart);
        return new LikeResponse(true, changed);
    }

    public LikeResponse unlike(String slug, AuthPrincipal actor) {
        long lookupStart = System.nanoTime();
        String articleId = repository.publishedArticleId(slug);
        ArticleMetricTiming.lookup(System.nanoTime() - lookupStart);
        long transactionStart = System.nanoTime();
        boolean changed = repository.unlike(articleId, actor.id());
        ArticleMetricTiming.transaction(System.nanoTime() - transactionStart);
        return new LikeResponse(false, changed);
    }

    public record StatsResponse(long viewCount, long likeCount, boolean likedByMe, String updatedAt) { }
    public record ViewResponse(String eventId, boolean changed) { }
    public record LikeResponse(boolean liked, boolean changed) { }
}
