# 本地网页文章编辑器

编辑器只用于可信本机，不加入主导航，也不提供 Git 提交或发布按钮。它已经整合到 Python 主后端，直接把文章写入 `public/articles/<slug>/`；生产启动脚本默认关闭编辑接口。

## 启动

先安装 Python 依赖：

```powershell
python -m venv backend-python\.venv
backend-python\.venv\Scripts\python.exe -m pip install -r backend-python\requirements.txt
```

在根目录 `.env` 中启用编辑器页面：

```env
NEXT_PUBLIC_EDITOR_ENABLED=true
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
EDITOR_ENABLED=true
```

然后启动主后端和前端：

```powershell
npm.cmd run backend:python
npm.cmd run dev
```

浏览器打开 <http://localhost:3000/editor/>。编辑器和公开 API 共用 `8080` 端口，不再需要单独启动 8090 编辑 API。

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

编辑器接口只在 `EDITOR_ENABLED=true` 时工作：

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

## 编辑器登录

编辑接口需要管理员登录，写请求还需要 CSRF Token。编辑器是否开放由主后端的 `EDITOR_ENABLED` 控制；生产环境应保持关闭，或额外使用 Nginx/Cloudflare 访问控制。

本地 `.env` 至少配置：

```env
AUTH_ENABLED=true
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD=change-this-password
EDITOR_ENABLED=true
NEXT_PUBLIC_EDITOR_ENABLED=true
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

启动主 API 后，打开主页登录管理员账号，再访问 `http://localhost:3000/editor/`。编辑器与主 API 使用同一地址，因此 Session 和 CSRF Cookie 不需要跨端口共享。

普通用户访问编辑接口返回 `403 AUTH_FORBIDDEN`，未登录访问返回 `401 AUTH_REQUIRED`。

删除文章需要在编辑器中确认，且会同时从 `public/articles/` 和公开回退索引中移除。生产只读启动脚本不会打开编辑模式。完成编辑后，使用正常的 Git 操作提交 `public/articles/`，再按静态前端和只读后端的部署流程发布。
# 评论、回复与头像

本地编辑器和主站共用 Python 后端的 SQLite 鉴权数据库。文章详情页和说说页会显示评论；评论立即公开，访客可以读取，登录用户才可以发布、一级回复和删除自己的评论。

用户登录后可在导航栏账户面板上传 PNG、JPEG 或 WebP 头像。头像二进制保存于 SQLite，不会写入 `public/`。默认大小限制为 2 MiB，可通过 `AUTH_AVATAR_MAX_BYTES` 调整；评论可通过 `COMMENTS_ENABLED` 和 `COMMENTS_MAX_LENGTH` 配置。

生产部署时请备份 `backend-python/data/auth.sqlite3`，并继续保持编辑接口只在可信环境开放。
