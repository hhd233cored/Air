package org.airchord.backend.content;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.context.ApplicationEventPublisher;
import tools.jackson.databind.json.JsonMapper;
import java.nio.file.*;
import java.util.List;
import java.util.function.Consumer;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ContentIndexTest {
    @TempDir Path root;

    @Test
    void writesAllStreamedEntriesWithoutLoadingEditorPages() throws Exception {
        ContentReadRepository repository = repository();
        doAnswer(call -> {
            Consumer<ContentItemRecord> consumer = call.getArgument(1);
            for (int i = 0; i < 305; i++) consumer.accept(row("note-" + i));
            return null;
        }).when(repository).forEachPublishedIndexEntry(eq("CHATTER"), any());
        service(repository).updateChatter("note", null, null, null, "body", List.of());
        var entries = JsonMapper.builder().build().readTree(root.resolve("index.json").toFile());
        assertThat(entries.size()).isEqualTo(305);
        assertThat(entries.get(304).path("preview").asText()).isEqualTo("Stored preview");
        assertThat(entries.get(0).has("contentMarkdown")).isFalse();
        verify(repository, never()).listForEditor(anyString(), anyInt(), anyInt(), any());
    }

    @Test
    void failedStreamPreservesPreviousIndexAndRemovesTemporaryFile() throws Exception {
        Files.writeString(root.resolve("index.json"), "[\"previous\"]");
        ContentReadRepository repository = repository();
        doAnswer(call -> {
            Consumer<ContentItemRecord> consumer = call.getArgument(1);
            consumer.accept(row("first"));
            throw new IllegalStateException("simulated read failure");
        }).when(repository).forEachPublishedIndexEntry(eq("CHATTER"), any());
        service(repository).updateChatter("note", null, null, null, "body", List.of());
        assertThat(Files.readString(root.resolve("index.json"))).isEqualTo("[\"previous\"]");
        try (var paths = Files.list(root)) {
            assertThat(paths.map(path -> path.getFileName().toString()).toList())
                    .noneMatch(name -> name.startsWith(".index-"));
        }
    }

    private ContentReadRepository repository() {
        ContentReadRepository repository = mock(ContentReadRepository.class);
        when(repository.findForEditor("CHATTER", "note")).thenReturn(row("note"));
        return repository;
    }

    private ContentEditorService service(ContentReadRepository repository) {
        return new ContentEditorService(repository, mock(ApplicationEventPublisher.class),
                root.resolve("articles").toString(), root.toString(), true, 1024);
    }

    private ContentItemRecord row(String slug) {
        return new ContentItemRecord("CHATTER", slug, slug, null, null, null, null, List.of(),
                "PUBLISHED", null, "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z", "body", "Stored preview");
    }
}
