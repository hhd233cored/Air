# 本地网页文章编辑器

编辑器只用于可信本机，不加入主导航，也不提供登录、Git 提交或发布按钮。它直接把文章写入 `public/articles/<slug>/`，线上只读 API 和生产部署不受影响。

## 启动

先安装 Python 依赖：

```powershell
python -m venv backend-python\.venv
backend-python\.venv\Scripts\python.exe -m pip install -r backend-python\requirements.txt
```

在根目录 `.env` 中启用编辑器页面：

```env
NEXT_PUBLIC_EDITOR_ENABLED=true
NEXT_PUBLIC_EDITOR_API_BASE_URL=http://127.0.0.1:8090
```

然后分别启动前端和本地编辑 API：

```powershell
npm.cmd run dev
npm.cmd run editor:local
```

浏览器打开 <http://localhost:3000/editor>。编辑 API 默认只监听 `127.0.0.1:8090`；如需调整端口，可设置 `EDITOR_SERVER_PORT`，不要把 `EDITOR_BIND_HOST` 改成公网地址。

## 编辑和保存

- 新文章默认是 `DRAFT`，必须选择 SVG、PNG、JPG/JPEG 或 WebP 封面。
- 标题会生成可编辑的 Slug；Slug 只能使用小写字母、数字和连字符。
- 正文图片会复制到 `assets/`，编辑器会把 Markdown 图片引用插入正文。
- 保存时更新 `updatedAt`，首次保存为 `PUBLISHED` 时自动补齐 `publishedAt`。
- 保存后会重新生成 `public/articles/index.json`；草稿和归档不会进入公开回退索引。
- 修改文章时不会删除已有的 `assets/` 文件。
- 编辑器也支持新建、修改和删除说说，文件位于 `public/chatter/<slug>/`。

生成的目录示例：

```text
public/articles/quiet-corner/
  article.json
  article.md
  cover.webp
  assets/
    note.png
```

## API

编辑 API 只在 `EDITOR_ENABLED=true` 时工作：

```text
GET  /api/v1/editor/articles
GET  /api/v1/editor/articles/{slug}
POST /api/v1/editor/articles
PUT  /api/v1/editor/articles/{slug}
DELETE /api/v1/editor/articles/{slug}
GET  /api/v1/editor/chatter
GET  /api/v1/editor/chatter/{slug}
POST /api/v1/editor/chatter
PUT  /api/v1/editor/chatter/{slug}
DELETE /api/v1/editor/chatter/{slug}
```

删除文章需要在编辑器中确认，且会同时从 `public/articles/` 和公开回退索引中移除。生产只读启动脚本不会打开编辑模式。完成编辑后，使用正常的 Git 操作提交 `public/articles/`，再按静态前端和只读后端的部署流程发布。
