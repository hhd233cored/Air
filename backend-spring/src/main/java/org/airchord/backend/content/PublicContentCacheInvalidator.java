package org.airchord.backend.content;

import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/** 将内容写事务和 Redis 缓存解耦，只在数据库提交成功后删除公开缓存。 */
@Component
public class PublicContentCacheInvalidator {

    private final PublicContentCache cache;

    public PublicContentCacheInvalidator(PublicContentCache cache) {
        this.cache = cache;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void afterContentTransactionCommits(PublicContentChangedEvent event) {
        cache.evict(event.contentType(), event.affectedSlugs());
    }
}
