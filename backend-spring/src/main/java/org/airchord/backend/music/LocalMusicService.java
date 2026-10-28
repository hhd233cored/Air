package org.airchord.backend.music;

import org.airchord.backend.music.MusicDtos.*;
import org.airchord.backend.web.BackendApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.jaudiotagger.audio.AudioFile;
import org.jaudiotagger.audio.AudioFileIO;
import org.jaudiotagger.audio.AudioHeader;
import org.jaudiotagger.tag.FieldKey;
import org.jaudiotagger.tag.Tag;
import org.jaudiotagger.tag.images.Artwork;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.FileTime;
import java.util.*;
import java.util.stream.Stream;

/** 本地文件音乐目录适配器；播放文件不进入数据库，playlist.json 维护稳定 track id。 */
@Service
public class LocalMusicService {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final Set<String> EXTENSIONS = Set.of(".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac", ".webm");
    private final Path root;
    private final Path playlistFile;
    private final long maxUploadBytes;
    private final String source;
    private final int metadataCacheSize;
    private final AudioReader audioReader;
    // 只缓存轻量标签；不缓存 AudioFile、Tag、Artwork 或封面 byte[]。
    private final Map<Path, CachedMetadata> metadataCache = new LinkedHashMap<>(16, 0.75f, true);

    @Autowired
    public LocalMusicService(@Value("${airchord.media.music-dir:../music}") String directory,
                             @Value("${airchord.music.max-upload-bytes:52428800}") long maxUploadBytes,
                             @Value("${MUSIC_SOURCE:local}") String source) {
        this(directory, maxUploadBytes, source, 256, path -> AudioFileIO.read(path.toFile()));
    }

    LocalMusicService(String directory, long maxUploadBytes, String source, int metadataCacheSize, AudioReader audioReader) {
        this.root = Path.of(directory).toAbsolutePath().normalize();
        this.playlistFile = root.resolve("playlist.json");
        this.maxUploadBytes = maxUploadBytes;
        this.source = source == null ? "local" : source.strip().toLowerCase(Locale.ROOT);
        this.metadataCacheSize = Math.max(1, metadataCacheSize);
        this.audioReader = audioReader;
    }

    public Playlist getPlaylist() {
        requireLocal();
        JsonNode playlist = readPlaylist();
        JsonNode rawTracks = playlist.path("tracks");
        if (!rawTracks.isArray()) throw error("LOCAL_MUSIC_INVALID_PLAYLIST", "歌单 tracks 必须是数组", 502);
        Map<String, Path> audioFiles = indexAudioFiles();
        List<Track> tracks = new ArrayList<>();
        for (JsonNode raw : rawTracks) {
            String id = raw.path("id").asText("").strip();
            String name = raw.path("name").asText("").strip();
            if (id.isBlank() || name.isBlank()) continue;
            Path audio = locate(audioFiles, id, name);
            if (audio == null) continue;
            Metadata metadata = metadata(audio, name);
            String cover = metadata.hasCover ? "/api/v1/music/tracks/" + encode(id) + "/cover" : null;
            tracks.add(new Track(id, metadata.title, metadata.artist, metadata.album, cover,
                    metadata.durationMs, true, false));
        }
        String playlistId = playlist.path("id").asText("local");
        return new Playlist(playlistId, "local", tracks, !tracks.isEmpty(),
                tracks.isEmpty() ? "本地歌单暂时没有可播放歌曲" : null);
    }

    public TrackUrl trackUrl(String trackId) {
        TrackEntry track = requireTrack(trackId);
        Metadata metadata = metadata(track.file, track.name);
        String relative = root.relativize(track.file).toString().replace('\\', '/');
        String url = "/music/" + Arrays.stream(relative.split("/"))
                .map(LocalMusicService::encode).reduce((a, b) -> a + "/" + b).orElse("");
        return new TrackUrl(track.id, url, null, metadata.durationMs, true, null);
    }

    public Cover trackCover(String trackId) {
        TrackEntry track = requireTrack(trackId);
        try {
            AudioFile audio = audioReader.read(track.file);
            Artwork artwork = audio.getTag() == null ? null : audio.getTag().getFirstArtwork();
            byte[] cover = artwork == null ? null : artwork.getBinaryData();
            if (cover != null) return new Cover(cover, artwork.getMimeType() == null
                    ? detectImageType(cover) : artwork.getMimeType());
        } catch (Exception ignored) {
            // 保留不支持的音频格式或缺失封面的 404 行为。
        }
        throw error("LOCAL_MUSIC_COVER_NOT_FOUND", "歌曲没有内嵌封面", 404);
    }

    public synchronized Playlist addTrack(MultipartFile audio) {
        String filename = validateUpload(audio);
        String id = "song-" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        try {
            try (InputStream input = audio.getInputStream()) { storeTrack(input, filename, id); }
            return getPlaylist();
        } catch (BackendApiException ex) { throw ex; }
        catch (Exception ex) { throw error("LOCAL_MUSIC_PLAYLIST_WRITE_FAILED", "音频文件或歌单保存失败", 500); }
    }

    /** 两种上传入口共用校验规则；返回已去掉客户端目录部分的原始文件名。 */
    public String validateUpload(MultipartFile audio) {
        requireLocal();
        if (audio == null || audio.isEmpty()) throw error("LOCAL_MUSIC_EMPTY_FILE", "音频文件不能为空", 400);
        if (audio.getSize() > maxUploadBytes) throw error("LOCAL_MUSIC_FILE_TOO_LARGE", "音频文件不能超过 50 MiB", 413);
        String filename = audio.getOriginalFilename() == null ? "" :
                Path.of(audio.getOriginalFilename().replace('\\', '/')).getFileName().toString();
        if (!EXTENSIONS.contains(extension(filename)))
            throw error("LOCAL_MUSIC_UNSUPPORTED_FORMAT", "音频格式不支持", 400);
        return filename;
    }

    /** 队列可能重复投递；固定 trackId 已在歌单中时只确认现有文件，不重复追加条目。 */
    public synchronized void addStagedTrack(Path stagedFile, String originalFilename, String trackId) {
        requireLocal();
        if (!trackId.matches("song-[0-9a-f]{32}"))
            throw error("LOCAL_MUSIC_INVALID_TRACK", "歌曲 ID 无效", 400);
        if (!EXTENSIONS.contains(extension(originalFilename)))
            throw error("LOCAL_MUSIC_UNSUPPORTED_FORMAT", "音频格式不支持", 400);
        try {
            long bytes = Files.size(stagedFile);
            if (bytes == 0 || bytes > maxUploadBytes)
                throw error("LOCAL_MUSIC_FILE_TOO_LARGE", "暂存音频大小无效", 413);
            try (InputStream input = Files.newInputStream(stagedFile)) {
                storeTrack(input, originalFilename, trackId);
            }
        } catch (BackendApiException ex) { throw ex; }
        catch (Exception ex) { throw error("LOCAL_MUSIC_PLAYLIST_WRITE_FAILED", "音频文件或歌单保存失败", 500); }
    }

    private void storeTrack(InputStream input, String filename, String id) throws IOException {
        String ext = extension(filename);
        String name = filename.substring(0, filename.length() - ext.length()).strip();
        if (name.isBlank()) name = "Uploaded song";
        ObjectNode playlist = readPlaylistForWrite();
        JsonNode previous = playlist.path("tracks");
        Path target = root.resolve(id + ext);
        for (JsonNode entry : previous) {
            if (!id.equals(entry.path("id").asText())) continue;
            if (!name.equals(entry.path("name").asText()))
                throw error("LOCAL_MUSIC_TRACK_CONFLICT", "歌曲 ID 已被其他文件使用", 409);
            if (Files.isRegularFile(target)) return;
            // 上次在写入歌单后中断：只恢复文件，避免重复增加歌单项。
            copyAtomically(input, target);
            return;
        }
        copyAtomically(input, target);
        try {
            ArrayNode tracks = JSON.createArrayNode();
            if (previous.isArray()) previous.forEach(tracks::add);
            tracks.addObject().put("id", id).put("name", name);
            playlist.set("tracks", tracks);
            writePlaylist(playlist);
        } catch (Exception ex) {
            Files.deleteIfExists(target);
            throw ex;
        }
    }

    private void copyAtomically(InputStream input, Path target) throws IOException {
        Files.createDirectories(root);
        Path temp = root.resolve("." + target.getFileName() + ".tmp-" + UUID.randomUUID());
        try {
            Files.copy(input, temp);
            move(temp, target);
        } finally {
            Files.deleteIfExists(temp);
        }
    }

    public synchronized Playlist removeTrack(String trackId) {
        requireLocal();
        TrackEntry remove = requireTrack(trackId);
        ObjectNode playlist = readPlaylistForWrite();
        JsonNode previous = playlist.path("tracks");
        ArrayNode next = JSON.createArrayNode();
        if (previous.isArray()) previous.forEach(item -> {
            if (!trackId.equals(item.path("id").asText())) next.add(item);
        });
        if (previous.size() == next.size()) throw error("LOCAL_MUSIC_TRACK_NOT_FOUND", "歌单中不存在这首歌曲", 404);
        playlist.set("tracks", next);
        writePlaylist(playlist);
        boolean shared = false;
        Map<String, Path> existingFiles = indexAudioFiles();
        for (JsonNode item : next) {
            Path other = locate(existingFiles, item.path("id").asText(), item.path("name").asText());
            if (other != null && other.equals(remove.file)) { shared = true; break; }
        }
        // 先更新歌单，再删除不再被引用的音频文件。
        if (!shared) try {
            synchronized (metadataCache) { metadataCache.remove(remove.file.toRealPath()); }
            Files.deleteIfExists(remove.file);
        }
        catch (IOException ex) { throw error("LOCAL_MUSIC_DELETE_FAILED", "音频文件删除失败", 500); }
        return getPlaylist();
    }

    private TrackEntry requireTrack(String id) {
        if (id == null || id.isBlank()) throw error("LOCAL_MUSIC_INVALID_TRACK", "Song ID is required", 400);
        JsonNode tracks = readPlaylist().path("tracks");
        if (!tracks.isArray()) throw error("LOCAL_MUSIC_INVALID_PLAYLIST", "歌单 tracks 必须是数组", 502);
        for (JsonNode item : tracks) {
            if (!id.equals(item.path("id").asText())) continue;
            String name = item.path("name").asText("");
            Path file = locate(indexAudioFiles(), id, name);
            if (file != null) return new TrackEntry(id, name, file);
        }
        throw error("LOCAL_MUSIC_TRACK_NOT_FOUND", "本地歌单中不存在这首歌曲", 404);
    }

    private JsonNode readPlaylist() {
        if (!Files.isRegularFile(playlistFile)) throw error("LOCAL_MUSIC_PLAYLIST_NOT_FOUND", "本地歌单文件不存在", 404);
        try (var input = Files.newInputStream(playlistFile)) { return JSON.readTree(input); }
        catch (Exception ex) { throw error("LOCAL_MUSIC_INVALID_PLAYLIST", "本地歌单 JSON 无法读取", 502); }
    }

    private ObjectNode readPlaylistForWrite() {
        if (!Files.exists(playlistFile)) {
            ObjectNode empty = JSON.createObjectNode(); empty.put("id", "local"); empty.put("title", "Local playlist"); empty.putArray("tracks"); return empty;
        }
        JsonNode node = readPlaylist();
        if (!(node instanceof ObjectNode object)) throw error("LOCAL_MUSIC_INVALID_PLAYLIST", "本地歌单必须是 JSON 对象", 502);
        if (!object.path("tracks").isArray()) throw error("LOCAL_MUSIC_INVALID_PLAYLIST", "歌单 tracks 必须是数组", 502);
        return object;
    }

    private void writePlaylist(ObjectNode playlist) {
        try {
            Files.createDirectories(root);
            Path temp = root.resolve(".playlist-" + UUID.randomUUID() + ".tmp");
            Files.writeString(temp, JSON.writerWithDefaultPrettyPrinter().writeValueAsString(playlist) + "\n", StandardCharsets.UTF_8);
            move(temp, playlistFile);
        } catch (Exception ex) { throw error("LOCAL_MUSIC_PLAYLIST_WRITE_FAILED", "歌单无法保存", 500); }
    }

    private Map<String, Path> indexAudioFiles() {
        if (!Files.isDirectory(root)) return Map.of();
        Path realRoot;
        try { realRoot = root.toRealPath(); } catch (IOException ex) { return Map.of(); }
        try (Stream<Path> files = Files.walk(root)) {
            Map<String, Path> index = new HashMap<>();
            files.filter(Files::isRegularFile).filter(path -> EXTENSIONS.contains(extension(path.getFileName().toString())))
                    .filter(path -> { try { return path.toRealPath().startsWith(realRoot); } catch (IOException ex) { return false; } })
                    .forEach(path -> index.putIfAbsent(normalize(stem(path)), path));
            return index;
        } catch (IOException ex) { return Map.of(); }
    }

    private static Path locate(Map<String, Path> files, String id, String name) {
        Path byId = files.get(normalize(id));
        return byId == null ? files.get(normalize(name)) : byId;
    }

    private Metadata metadata(Path path, String fallback) {
        Metadata value;
        try {
            Path realPath = path.toRealPath();
            // 保持有界且合并并发的标签解析；文件属性每次检查，外部替换文件也会失效。
            synchronized (metadataCache) {
                BasicFileAttributes attributes = Files.readAttributes(realPath, BasicFileAttributes.class);
                CachedMetadata cached = metadataCache.get(realPath);
                if (cached != null && cached.matches(attributes)) value = cached.value;
                else {
                    value = readMetadata(realPath);
                    metadataCache.put(realPath, new CachedMetadata(attributes.size(), attributes.lastModifiedTime(),
                            attributes.fileKey(), value));
                    while (metadataCache.size() > metadataCacheSize) {
                        var oldest = metadataCache.keySet().iterator();
                        oldest.next(); oldest.remove();
                    }
                }
            }
        } catch (IOException ex) {
            value = new Metadata(null, "未知艺人", null, null, false);
        }
        // 文件名/歌单名可能独立变化，不把回退标题固化在文件元数据缓存中。
        return new Metadata(first(value.title, fallback == null || fallback.isBlank() ? stem(path) : fallback),
                value.artist, value.album, value.durationMs, value.hasCover);
    }

    private Metadata readMetadata(Path path) {
        String title = null;
        String artist = "未知艺人", album = null;
        Long duration = null; boolean hasCover = false;
        try {
            AudioFile audio = audioReader.read(path);
            Tag tag = audio.getTag();
            if (tag != null) {
                title = first(tag.getFirst(FieldKey.TITLE), title);
                artist = first(tag.getFirst(FieldKey.ARTIST), artist);
                album = blankToNull(tag.getFirst(FieldKey.ALBUM));
                hasCover = tag.getFirstArtwork() != null;
            }
            AudioHeader header = audio.getAudioHeader();
            if (header != null && header.getTrackLength() > 0) duration = header.getTrackLength() * 1000L;
        } catch (Exception ignored) {
            // 对 WebM 和缺失标签等不受支持的文件，歌单仍可用文件名和空元数据播放。
        }
        return new Metadata(title, artist, album, duration, hasCover);
    }

    private void requireLocal() {
        if (!"local".equals(source)) throw error("LOCAL_MUSIC_SOURCE_REQUIRED", "仅本地音乐模式支持此接口", 409);
    }
    private static String first(String value, String fallback) { return value == null || value.isBlank() ? fallback : value.strip(); }
    private static String blankToNull(String value) { return value == null || value.isBlank() ? null : value.strip(); }
    private static String normalize(String value) { return value == null ? "" : value.toLowerCase(Locale.ROOT).replaceAll("\\s+", ""); }
    private static String stem(Path path) { String name = path.getFileName().toString(); return name.substring(0, name.length() - extension(name).length()); }
    private static String extension(String name) { int dot = name.lastIndexOf('.'); return dot < 0 ? "" : name.substring(dot).toLowerCase(Locale.ROOT); }
    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20"); }
    private static String detectImageType(byte[] bytes) {
        if (bytes.length >= 3 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216) return "image/jpeg";
        if (bytes.length >= 8 && bytes[0] == (byte) 0x89 && bytes[1] == 'P') return "image/png";
        if (bytes.length >= 12 && bytes[0] == 'R' && bytes[8] == 'W') return "image/webp";
        return "image/jpeg";
    }
    private static void move(Path from, Path to) throws IOException {
        try { Files.move(from, to, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
        catch (AtomicMoveNotSupportedException ex) { Files.move(from, to, StandardCopyOption.REPLACE_EXISTING); }
    }
    private static BackendApiException error(String code, String message, int status) { return new BackendApiException(code, message, status); }
    private record TrackEntry(String id, String name, Path file) { }
    private record Metadata(String title, String artist, String album, Long durationMs, boolean hasCover) { }
    private record CachedMetadata(long size, FileTime modified, Object fileKey, Metadata value) {
        boolean matches(BasicFileAttributes attributes) {
            return size == attributes.size() && modified.equals(attributes.lastModifiedTime())
                    && Objects.equals(fileKey, attributes.fileKey());
        }
    }
    @FunctionalInterface
    interface AudioReader { AudioFile read(Path path) throws Exception; }
}
