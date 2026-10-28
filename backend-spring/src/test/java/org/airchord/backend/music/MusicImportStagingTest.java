package org.airchord.backend.music;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

/** 私有目录按真实文件占用限额，不把失败文件从磁盘配额中漏算。 */
class MusicImportStagingTest {
    @TempDir Path root;

    @Test
    void rejectsWhenStoredFilesAlreadyUseTheStagingBudget() throws Exception {
        MusicImportStaging staging = new MusicImportStaging(root.toString(), 10, 10,
                mock(MusicImportRepository.class));
        UUID first = UUID.randomUUID();
        assertThat(staging.stage(first, new MockMultipartFile("audio", "a.mp3", "audio/mpeg",
                "123456".getBytes()))).isEqualTo(6);
        UUID second = UUID.randomUUID();
        assertThatThrownBy(() -> staging.stage(second, new MockMultipartFile("audio", "b.mp3", "audio/mpeg",
                "12345".getBytes()))).isInstanceOf(MusicImportCapacityException.class);
        assertThat(Files.readString(staging.file(first))).isEqualTo("123456");
        assertThat(Files.exists(staging.file(second))).isFalse();
    }
}
