# 文章目录导入/导出

脚本现在主要操作本地文件，不需要启动后端；内容迁移脚本会按需写入 Python 后端使用的 SQLite 数据库。

## 导出

```powershell
powershell -ExecutionPolicy Bypass -File scripts/export-articles.ps1
```

默认导出到 `article-export/`：

```text
article-export/
  manifest.json
  articles/
    first-note/
      article.json
      article.md
      cover.svg
      assets/
```

## 导入

```powershell
powershell -ExecutionPolicy Bypass -File scripts/import-articles.ps1
```

导入并设置为已发布：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/import-articles.ps1 -Publish
```

导入后会生成或更新：

```text
public/articles/<slug>/article.json
public/articles/<slug>/article.md
public/articles/<slug>/cover.svg/png/jpg
public/articles/index.json
```

支持 SVG、PNG、JPG/JPEG 和 WebP 封面。`-PublicDirectory` 可以指定其它静态资源目录。

旧版 `-Username`、`-Password`、`-BaseUrl`、`-UpdateExisting` 参数仍被保留以兼容旧命令，但当前导入过程不会访问 API，也不会执行登录。

## 迁移到 SQLite 内容表

文章和说说可以迁移到现有鉴权数据库。先执行只读检查：

```powershell
npm.cmd run content:migrate -- -DryRun
```

确认无误后执行实际迁移：

```powershell
npm.cmd run content:migrate
```

迁移不会删除 `public/articles/` 和 `public/chatter/`，封面、正文图片及 Markdown 仍保留为备份。完成后在 `.env` 设置 `CONTENT_STORAGE=database` 和 `NEXT_PUBLIC_CONTENT_STORAGE=database`，需要回滚时改回 `files`。
