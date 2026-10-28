package org.airchord.backend.music;

import java.util.UUID;

/** 异步任务响应只暴露处理状态；私有暂存路径永不返回给浏览器。 */
public final class MusicImportDtos {
    private MusicImportDtos() { }

    public record Accepted(UUID id, String status, String createdAt) { }
    public record Status(UUID id, String status, String trackId, String errorCode,
                         String createdAt, String updatedAt) { }
}
