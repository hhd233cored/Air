package org.airchord.backend.music;

import org.airchord.backend.web.BackendApiException;

/** 队列入口达到容量上限时，提示客户端稍后再上传。 */
public final class MusicImportCapacityException extends BackendApiException {
    public MusicImportCapacityException() {
        super("MUSIC_IMPORT_BUSY", "音频导入任务已满，请稍后重试", 503);
    }
}
