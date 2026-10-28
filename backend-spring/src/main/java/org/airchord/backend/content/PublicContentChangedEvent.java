package org.airchord.backend.content;

import java.util.List;

/** 写服务在事务内发布此事件；事务提交后清理受影响的公开详情 key。 */
public record PublicContentChangedEvent(String contentType, List<String> affectedSlugs) {
    public PublicContentChangedEvent {
        affectedSlugs = List.copyOf(affectedSlugs);
    }
}
