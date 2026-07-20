# AirChord

AirChord 是一个轻量化个人博客，包含 vinext 静态前端和 FastAPI Python 后端。后端使用单进程运行，文章、说说和鉴权数据使用 SQLite，媒体文件保留在项目目录中。

## 环境要求

- Node.js >=22.13.0
- Python 3.11+

服务器运行时只需要 Python；Node.js 仅用于本地前端开发和生成静态文件。

## 本地启动

安装前端依赖：

~~~powershell
npm.cmd install
~~~

启动 Python 后端：

~~~powershell
npm.cmd run backend:python
~~~

启动前端开发服务：

~~~powershell
npm.cmd run dev
~~~

- 前端：http://localhost:3000
- 后端：http://localhost:8080

如果需要在局域网访问后端：

~~~powershell
$env:PYTHON_HOST = "0.0.0.0"
npm.cmd run backend:python
~~~

## 配置

复制 .env.example 为 .env，按需修改：

~~~env
SERVER_PORT=8080
ARTICLE_CONTENT_DIR=./public/articles
CHATTER_CONTENT_DIR=./public/chatter
CONTENT_STORAGE=database
NEXT_PUBLIC_CONTENT_STORAGE=database
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
~~~

首次启动鉴权时，会根据 .env 中的管理员和普通用户配置创建账号。密码只保存为 Argon2id 哈希；生产环境请修改默认密码，并且不要提交 .env 或 backend-python/data/。

编辑器仅用于本机：

~~~env
EDITOR_ENABLED=true
NEXT_PUBLIC_EDITOR_ENABLED=true
~~~

生产环境应保持编辑器关闭。

## 生产部署

### 静态前端

构建静态文件：

~~~powershell
npm.cmd run build
~~~

静态文件位于：

~~~text
dist/client/
~~~

可以将 dist/client/ 部署到 Cloudflare Pages、Nginx 或其它静态托管服务。Cloudflare Pages 的构建配置通常为：

- 构建命令：npm run build
- 输出目录：dist/client
- 环境变量：NEXT_PUBLIC_API_BASE_URL=https://你的后端域名

### Python 后端

Linux 首次安装：

~~~bash
cd /opt/air
bash backend-python/install-linux.sh
~~~

启动：

~~~bash
cd /opt/air
set -a
. ./.env
set +a
backend-python/.venv/bin/uvicorn app.main:app \
  --app-dir backend-python \
  --host 127.0.0.1 \
  --port "$SERVER_PORT" \
  --workers 1
~~~

也可以使用：

~~~bash
npm.cmd run backend:python:prod
~~~

生产环境建议使用 systemd 管理进程，并由 Nginx 或 Cloudflare 将 /api 和 /music 转发到后端。

## 文章和说说

默认推荐使用数据库模式：

~~~env
CONTENT_STORAGE=database
NEXT_PUBLIC_CONTENT_STORAGE=database
~~~

文章和说说正文保存在现有 SQLite 数据库的 content_items 表中，FTS5 用于搜索；封面图、正文图片和音乐文件仍保存在文件系统中。数据库迁移前可以使用文件模式：

~~~powershell
npm.cmd run content:migrate -- -DryRun
npm.cmd run content:migrate
~~~

迁移成功后再将 CONTENT_STORAGE 改为 database。原有 public/articles/ 和 public/chatter/ 文件会保留为备份。

文件模式的文章目录示例：

~~~text
public/articles/first-note/
  article.json
  article.md
  cover.webp
  assets/
~~~

## 编辑器

编辑器页面为 /editor/，不加入公共导航。它和 Python 后端共用 8080 端口，需要管理员登录：

~~~powershell
npm.cmd run backend:python
npm.cmd run dev
~~~

管理员账号登录后访问 http://localhost:3000/editor/。数据库模式下编辑器直接修改 SQLite 内容表，同时保留媒体文件和 Markdown 备份。

## 主要 API

~~~text
GET /api/v1/health
GET /api/v1/articles
GET /api/v1/articles/{slug}
GET /api/v1/chatter
GET /api/v1/chatter/{slug}
GET /api/v1/search?q=关键词&type=ALL
GET /api/v1/historical-today
GET /api/v1/music/playlist
GET /api/v1/guestbook
~~~

评论、留言、鉴权、管理员账号管理和编辑器接口也由同一个 FastAPI 服务提供。公开读取接口不要求登录；写操作受 Session、CSRF、角色和限流保护。

## 常用命令

~~~powershell
npm.cmd run dev
npm.cmd run build
npm.cmd test
npm.cmd run lint
npm.cmd run backend:python
npm.cmd run backend:python:prod
npm.cmd run content:migrate
npm.cmd run articles:export
npm.cmd run articles:import
~~~

详细说明：

- Python 后端说明：backend-python/README.md
- 本地文章编辑器：docs/LOCAL-ARTICLE-EDITOR.md
- 文章导入导出：scripts/README.md
- 本地音乐：music/README.md
