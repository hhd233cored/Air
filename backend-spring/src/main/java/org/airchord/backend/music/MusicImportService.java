package org.airchord.backend.music;

import org.airchord.backend.music.MusicImportDtos.Accepted;
import org.airchord.backend.music.MusicImportDtos.Status;
import org.airchord.backend.web.BackendApiException;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.util.UUID;

/** HTTP 层先验证并持久暂存上传，再以一个数据库事务接受异步任务。 */
@Service
public class MusicImportService {
    private final LocalMusicService music;
    private final MusicImportStaging staging;
    private final MusicImportRepository jobs;

    public MusicImportService(LocalMusicService music, MusicImportStaging staging, MusicImportRepository jobs) {
        this.music = music;
        this.staging = staging;
        this.jobs = jobs;
    }

    public Accepted accept(MultipartFile audio, long actorId) {
        String filename = music.validateUpload(audio);
        UUID id = UUID.randomUUID();
        String trackId = "song-" + id.toString().replace("-", "");
        long bytes = staging.stage(id, audio);
        try {
            MusicImportRepository.Job job = jobs.enqueue(id, trackId, actorId, filename, bytes);
            return new Accepted(job.id(), job.status(), job.createdAt().toInstant().toString());
        } catch (RuntimeException ex) {
            // 提交结果不确定时宁可留待清理任务回收，也不能删掉可能已被接受的任务文件。
            if (ex instanceof MusicImportCapacityException) staging.delete(id);
            throw ex;
        }
    }

    public Status status(UUID id) {
        MusicImportRepository.Job job = jobs.find(id);
        if (job == null) throw new BackendApiException("MUSIC_IMPORT_NOT_FOUND", "音频导入任务不存在", 404);
        return new Status(job.id(), job.status(), "SUCCEEDED".equals(job.status()) ? job.trackId() : null,
                "FAILED".equals(job.status()) ? job.errorCode() : null,
                job.createdAt().toInstant().toString(), job.updatedAt().toInstant().toString());
    }
}
