package org.airchord.backend.music;

import org.jaudiotagger.audio.AudioFile;
import org.jaudiotagger.tag.Tag;
import org.jaudiotagger.tag.FieldKey;
import org.jaudiotagger.tag.images.Artwork;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.nio.file.attribute.FileTime;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class MusicMetadataCacheTest {
    @TempDir Path root;

    @Test
    void unchangedFilesReuseMetadataAndCoverBytesAreOnlyReadForCoverRequests() throws Exception {
        playlist("song");
        Files.writeString(root.resolve("song.mp3"), "test");
        AudioFile audio = mock(AudioFile.class);
        Tag tag = mock(Tag.class);
        Artwork art = mock(Artwork.class);
        when(audio.getTag()).thenReturn(tag);
        when(tag.getFirstArtwork()).thenReturn(art);
        when(tag.getFirst(FieldKey.TITLE)).thenReturn("Title");
        when(art.getBinaryData()).thenReturn(new byte[]{(byte) 0xff, (byte) 0xd8, (byte) 0xff});
        AtomicInteger reads = new AtomicInteger();
        LocalMusicService service = new LocalMusicService(root.toString(), 1024, "local", 2, path -> {
            reads.incrementAndGet(); return audio;
        });
        assertThat(service.getPlaylist().tracks().getFirst().title()).isEqualTo("Title");
        service.getPlaylist();
        service.trackUrl("song");
        assertThat(reads.get()).isEqualTo(1);
        verify(art, never()).getBinaryData();
        assertThat(service.trackCover("song").contentType()).isEqualTo("image/jpeg");
        verify(art).getBinaryData();
        assertThat(reads.get()).isEqualTo(2);
    }

    @Test
    void fileSizeAndTimestampChangesInvalidateMetadataAndLruIsBounded() throws Exception {
        playlist("a", "b");
        Path a = Files.writeString(root.resolve("a.mp3"), "one");
        Files.writeString(root.resolve("b.mp3"), "two");
        AtomicInteger reads = new AtomicInteger();
        LocalMusicService service = new LocalMusicService(root.toString(), 1024, "local", 1, path -> {
            reads.incrementAndGet(); return mock(AudioFile.class);
        });
        service.trackUrl("a"); service.trackUrl("a");
        assertThat(reads.get()).isEqualTo(1);
        FileTime original = Files.getLastModifiedTime(a);
        Files.writeString(a, "longer"); Files.setLastModifiedTime(a, original);
        service.trackUrl("a");
        assertThat(reads.get()).isEqualTo(2);
        Files.setLastModifiedTime(a, FileTime.fromMillis(original.toMillis() + 5000));
        service.trackUrl("a");
        assertThat(reads.get()).isEqualTo(3);
        service.trackUrl("b"); service.trackUrl("a");
        assertThat(reads.get()).isEqualTo(5);
    }

    @Test
    void externalPlaylistRenameUsesFreshFallbackWithoutReparsingAudio() throws Exception {
        playlist("song");
        Files.writeString(root.resolve("song.mp3"), "unsupported");
        AtomicInteger reads = new AtomicInteger();
        LocalMusicService service = new LocalMusicService(root.toString(), 1024, "local", 2, path -> {
            reads.incrementAndGet(); throw new IllegalArgumentException("unsupported audio");
        });
        assertThat(service.getPlaylist().tracks().getFirst().title()).isEqualTo("song");
        Files.writeString(root.resolve("playlist.json"), """
                {"tracks":[{"id":"song","name":"Renamed"}]}
                """);
        assertThat(service.getPlaylist().tracks().getFirst().title()).isEqualTo("Renamed");
        assertThat(reads.get()).isEqualTo(1);
    }

    private void playlist(String... ids) throws Exception {
        String tracks = java.util.Arrays.stream(ids)
                .map(id -> "{\"id\":\"" + id + "\",\"name\":\"" + id + "\"}")
                .collect(java.util.stream.Collectors.joining(","));
        Files.writeString(root.resolve("playlist.json"), "{\"tracks\":[" + tracks + "]}");
    }
}
