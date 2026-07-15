# 文章目录导入/导出

脚本现在只操作本地文件，不需要启动 Java 后端、不需要登录，也不需要数据库。

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
