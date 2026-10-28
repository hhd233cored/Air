package org.airchord.backend.content;

import db.migration.V1000__Backfill_content_previews;
import org.flywaydb.core.api.migration.Context;
import org.junit.jupiter.api.Test;
import java.sql.*;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class StoredPreviewTest {
    @Test
    void migrationBackfillsOldRowsUsingExactlyTheEditorPreviewRules() throws Exception {
        Context context = mock(Context.class);
        Connection connection = mock(Connection.class);
        PreparedStatement select = mock(PreparedStatement.class), update = mock(PreparedStatement.class);
        ResultSet rows = mock(ResultSet.class);
        when(context.getConnection()).thenReturn(connection);
        when(connection.prepareStatement(startsWith("SELECT"))).thenReturn(select);
        when(connection.prepareStatement(startsWith("UPDATE"))).thenReturn(update);
        when(select.executeQuery()).thenReturn(rows);
        when(rows.next()).thenReturn(true, true, true, false);
        when(rows.getString("id")).thenReturn("old-null", "old-stale", "old-empty");
        String body = "# 中文标题\n![图片](image.png)\n- [链接](https://example.com) **正文**";
        String longBody = "长".repeat(200);
        when(rows.getString("content_markdown")).thenReturn(body, longBody, "");
        new V1000__Backfill_content_previews().migrate(context);
        var writes = inOrder(update);
        writes.verify(update).setString(1, "中文标题 链接 正文");
        writes.verify(update).setString(2, "old-null");
        writes.verify(update).executeUpdate();
        writes.verify(update).setString(1, "长".repeat(159) + "…");
        writes.verify(update).setString(2, "old-stale");
        writes.verify(update).executeUpdate();
        writes.verify(update).setString(1, "");
        writes.verify(update).setString(2, "old-empty");
        writes.verify(update).executeUpdate();
        verify(rows).close();
        verify(select).close();
        verify(update).close();
    }

    @Test
    void publicListsSearchAndEditorListsUseStoredPreviewWithoutMarkdown() {
        ContentReadRepository repository = mock(ContentReadRepository.class);
        var row = new ContentItemRecord("CHATTER", "note", "note", null, null, null, null, List.of(),
                "PUBLISHED", null, null, null, null, "预先生成的摘要");
        var rows = new ContentReadRepository.PageRows<>(List.of(row), 1);
        when(repository.listChatter(0, 10, null)).thenReturn(rows);
        when(repository.search("摘要", "ALL", 0, 10)).thenReturn(rows);
        when(repository.listForEditor("CHATTER", 0, 10, null)).thenReturn(rows);
        ContentReadService publicContent = new ContentReadService(repository, null, ".");
        ContentEditorService editor = new ContentEditorService(repository, null, ".", ".", true, 1024);
        assertThat(publicContent.listChatter(0, 10, null).content().getFirst().preview()).isEqualTo(row.preview());
        assertThat(publicContent.search("摘要", "ALL", 0, 10).content().getFirst().preview()).isEqualTo(row.preview());
        assertThat(editor.listChatter(0, 10, null).content().getFirst().preview()).isEqualTo(row.preview());
    }
}
