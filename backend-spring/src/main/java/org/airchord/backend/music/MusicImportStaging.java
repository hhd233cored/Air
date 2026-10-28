package org.airchord.backend.music;

import org.airchord.backend.web.BackendApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.*;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.stream.Stream;

/** 私有暂存目录不挂在 /music/** 下；磁盘文件名只由服务端 UUID 生成。 */
@Component
public class MusicImportStaging {
    private static final Logger LOGGER = LoggerFactory.getLogger(MusicImportStaging.class);
    private final Path root;
    private final long maxFileBytes;
    private final long maxStagingBytes;
    private final MusicImportRepository jobs;

    public MusicImportStaging(@Value("${airchord.music.import-staging-dir:../.airchord-import-staging}") String directory,
                              @Value("${airchord.music.max-upload-bytes:52428800}") long maxFileBytes,
                              @Value("${airchord.music.import-max-staging-bytes:1073741824}") long maxStagingBytes,
                              MusicImportRepository jobs) {
        this.root = Path.of(directory).toAbsolutePath().normalize();
        this.maxFileBytes = maxFileBytes;
        this.maxStagingBytes = maxStagingBytes;
        this.jobs = jobs;
    }

    public Path file(UUID id) { return root.resolve(id + ".upload"); }

    public synchronized long stage(UUID id, MultipartFile audio) {
        Path temp = root.resolve(id + ".part");
        Path target = file(id);
        try {
            Files.createDirectories(root);
            // 同一 JVM 内串行核算磁盘暂存量，失败文件与孤立文件也计入上限。
            long used = 0;
            try (Stream<Path> entries = Files.list(root)) {
                for (Path entry : entries.filter(Files::isRegularFile).toList()) used += Files.size(entry);
            }
            if (audio.getSize() > maxStagingBytes - used) throw new MusicImportCapacityException();
            try (var input = audio.getInputStream()) { Files.copy(input, temp); }
            long bytes = Files.size(temp);
            if (bytes == 0 || bytes > maxFileBytes)
                throw new BackendApiException("LOCAL_MUSIC_FILE_TOO_LARGE", "音频文件不能超过 50 MiB", 413);
            if (bytes > maxStagingBytes - used) throw new MusicImportCapacityException();
            try { Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE); }
            catch (AtomicMoveNotSupportedException ex) { Files.move(temp, target); }
            return bytes;
        } catch (BackendApiException ex) { throw ex; }
        catch (Exception ex) { throw new BackendApiException("MUSIC_IMPORT_STAGING_FAILED", "音频暂存失败", 500); }
        finally {
            try { Files.deleteIfExists(temp); }
            catch (IOException ex) { LOGGER.warn("暂存临时文件清理失败: {}", temp, ex); }
        }
    }

    public void delete(UUID id) {
        try { Files.deleteIfExists(file(id)); }
        catch (IOException ex) { LOGGER.warn("任务暂存文件稍后清理: {}", id, ex); }
    }

    /** 进程可能在写文件后、建任务前退出；定时清理没有对应任务的旧文件。 */
    @Scheduled(fixedDelay = 3_600_000, initialDelay = 60_000)
    public void cleanExpired() {
        if (!Files.isDirectory(root)) return;
        try (Stream<Path> entries = Files.list(root)) {
            entries.filter(Files::isRegularFile).forEach(this::cleanOne);
        } catch (IOException ex) { LOGGER.warn("音频暂存目录扫描失败", ex); }
    }

    private void cleanOne(Path path) {
        String name = path.getFileName().toString();
        try {
            OffsetDateTime modified = Files.getLastModifiedTime(path).toInstant().atOffset(ZoneOffset.UTC);
            boolean remove;
            if (name.endsWith(".upload")) {
                UUID id = UUID.fromString(name.substring(0, name.length() - ".upload".length()));
                remove = jobs.mayDeleteStaged(id, modified);
            } else {
                remove = name.endsWith(".part") && modified.isBefore(OffsetDateTime.now(ZoneOffset.UTC).minusDays(1));
            }
            if (remove) Files.deleteIfExists(path);
        } catch (IllegalArgumentException ignored) {
            // 非本组件命名的文件不动，避免误删操作者放在同目录的内容。
        } catch (Exception ex) { LOGGER.warn("暂存文件清理失败: {}", name, ex); }
    }
}
