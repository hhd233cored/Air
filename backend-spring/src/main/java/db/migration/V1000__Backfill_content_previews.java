package db.migration;

import org.airchord.backend.content.MarkdownPreview;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

/** 版本排在已有 V900/V901 本地夹具之后；生产和已有本地数据库均执行一次。 */
public class V1000__Backfill_content_previews extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        // 游标每批最多读取 100 条正文，逐条更新，不在内存中汇总整个内容库。
        try (var select = context.getConnection().prepareStatement(
                "SELECT id, content_markdown FROM content_items ORDER BY id");
             var update = context.getConnection().prepareStatement(
                     "UPDATE content_items SET preview = ? WHERE id = ?")) {
            select.setFetchSize(100);
            try (var rows = select.executeQuery()) {
                while (rows.next()) {
                    update.setString(1, MarkdownPreview.from(rows.getString("content_markdown")));
                    update.setString(2, rows.getString("id"));
                    update.executeUpdate();
                }
            }
        }
    }
}
