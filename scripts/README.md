# 文章导入/导出脚本

这些 PowerShell 脚本通过本地 Java API 操作文章，不需要直接访问数据库。

运行前请确认后端已启动在 `http://localhost:8080`。

## 导出文章

将所有已发布文章导出到 `article-export/`：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/export-articles.ps1
```

导出目录结构：

```text
article-export/
  manifest.json
  articles/
    first-note.md
    ...
  covers/
    first-note.svg
    ...
```

其中：

- `manifest.json` 保存文章元数据、封面地址和导出文件路径
- `articles/` 保存 Markdown 正文
- `covers/` 保存文章封面文件

如果前端的静态资源目录不是默认的 `public/`，可以指定：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/export-articles.ps1 -PublicDirectory "C:\path\to\public"
```

本地封面会从 `public/` 复制；如果 `coverUrl` 是 HTTP/HTTPS 地址，脚本会尝试下载封面。

## 导入文章

将导出文件导入为草稿：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/import-articles.ps1
```

导入后立即发布：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/import-articles.ps1 -Publish
```

按相同 slug 更新已有文章，而不是创建重复文章：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/import-articles.ps1 -UpdateExisting -Publish
```

导入时，封面会复制到目标前端的 `public/article-covers/`，文章会使用对应的本地 `/article-covers/...` 路径。若目标前端的静态资源目录不同，请使用 `-PublicDirectory` 指定。
