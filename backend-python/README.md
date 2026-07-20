# Python 后端

这是个人博客的轻量 FastAPI 后端，负责公开内容、鉴权、评论、留言、音乐、历史上的今天和本地编辑器接口。后端使用 SQLite 保存鉴权、评论、留言和数据库模式下的文章/说说内容，不需要独立数据库服务、Docker 或 ORM。

## 接口

```text
GET /api/v1/health
GET /api/v1/admin/users
POST /api/v1/admin/users
PATCH /api/v1/admin/users/{id}
POST /api/v1/admin/users/{id}/reset-password
PUT /api/v1/admin/users/{id}/avatar
DELETE /api/v1/admin/users/{id}/avatar
GET /api/v1/admin/settings/registration
PATCH /api/v1/admin/settings/registration
GET /api/v1/articles
GET /api/v1/articles/{slug}
GET /api/v1/chatter
GET /api/v1/chatter/{slug}
GET /api/v1/historical-today
GET /api/v1/music/playlist
GET /api/v1/music/tracks/{songId}/url
GET /api/v1/music/tracks/{songId}/cover
GET /api/v1/admin/music/tracks
POST /api/v1/admin/music/tracks
DELETE /api/v1/admin/music/tracks/{songId}
```

## Python 后端鉴权（SQLite）

鉴权数据只保存在 `backend-python/data/auth.sqlite3`，不需要 PostgreSQL、Docker 或 ORM。首次启动时，如果账号不存在，服务会根据环境变量创建管理员和可选普通用户；已存在账号不会被环境变量覆盖。

```env
AUTH_ENABLED=true
AUTH_DATABASE_PATH=./backend-python/data/auth.sqlite3
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD=change-this-password
AUTH_USER_USERNAME=reader
AUTH_USER_PASSWORD=change-this-password
AUTH_SESSION_TIMEOUT=7d
AUTH_COOKIE_NAME=air_session
AUTH_COOKIE_SECURE=false
AUTH_COOKIE_SAMESITE=Lax
AUTH_CSRF_ENABLED=true
AUTH_REGISTRATION_ENABLED=true
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://airchord.org,https://www.airchord.org
```

密码至少 8 个字符。生产环境使用 HTTPS 时设置 `AUTH_COOKIE_SECURE=true`；只有在前端与 API 被浏览器视为跨站时，才将 `AUTH_COOKIE_SAMESITE` 改为 `None`。

鉴权接口为 `GET /api/v1/auth/csrf`、`POST /api/v1/auth/register`、`POST /api/v1/auth/login`、`POST /api/v1/auth/logout` 和 `GET /api/v1/auth/me`。公开注册创建的账号永远是 `USER`，不能通过接口创建管理员。管理员可以在 `/admin` 页面控制公开注册，或者调用 `/api/v1/admin/settings/registration`；该设置保存到 SQLite，`AUTH_REGISTRATION_ENABLED` 只作为首次初始化默认值。公开 GET 接口保持匿名可用；只有 ADMIN 可以访问本地编辑器接口，USER 只能登录并读取公开内容。编辑器已经整合在同一个 FastAPI 进程中，由 `EDITOR_ENABLED=true` 控制；生产启动脚本会强制关闭。

本地编辑时只需启动主 API；编辑器和公开 API 共用 `8080` 端口，浏览器天然共享 Session 和 CSRF Cookie。登录主站后再打开 `/editor`。鉴权数据库已经加入 Git 忽略规则，但生产服务器应备份 `backend-python/data/auth.sqlite3`。

说说保存在 `public/chatter/`，每条说说使用一个独立目录：

```text
public/chatter/life-changelog/
  chatter.json
  chatter.md
```

`chatter.json` 只保存 `id`、`slug`、状态和时间字段；正文保存在 `chatter.md`，不使用封面图。列表接口会从 Markdown 正文生成 `preview`，只返回 `PUBLISHED` 说说。

音乐来源由 `MUSIC_SOURCE` 控制，默认是本地音乐：

```env
MUSIC_SOURCE=local
MUSIC_CONTENT_DIR=./music
# 管理员单次上传音乐的大小上限，默认 50 MiB
MUSIC_MAX_UPLOAD_BYTES=52428800
```

切换为网易云歌单：

```env
MUSIC_SOURCE=netease
```

本地音乐放在 `music/` 目录，歌单文件为 `music/playlist.json`。JSON 只保存歌曲 `id` 和 `name`，标题、作者、专辑、时长和内嵌封面由 `mutagen` 从音频文件读取。后端只返回歌曲元数据和音频 URL，音频文件由 `/music/` 静态路径提供。

管理员登录后可以在 `/admin/` 的“音乐管理”区域上传或删除本地音乐。上传接口只在 `MUSIC_SOURCE=local` 时开放，文件会保存到 `MUSIC_CONTENT_DIR`，并自动更新 `playlist.json`。支持 `.mp3`、`.m4a`、`.aac`、`.wav`、`.ogg`、`.flac` 和 `.webm`；单文件大小受 `MUSIC_MAX_UPLOAD_BYTES` 限制。上传请求使用现有管理员 Session、CSRF 和管理员限流规则。

接口路径和响应结构保持稳定，前端不需要修改 API 适配层。

## Linux 一键安装

在项目根目录执行：

```bash
bash backend-python/install-linux.sh
```

脚本会检查 Python 3.11+，创建 `backend-python/.venv`，并安装运行依赖。它不会修改系统 Python，也不会安装独立数据库服务或 Docker。

启动服务：

```bash
backend-python/.venv/bin/uvicorn app.main:app \
  --app-dir backend-python \
  --host 0.0.0.0 \
  --port 8080 \
  --workers 1
```

## Windows 本地启动

先安装依赖：

```powershell
python -m venv backend-python\.venv
backend-python\.venv\Scripts\python.exe -m pip install -r backend-python\requirements.txt
```

然后运行：

```powershell
npm.cmd run backend:python
```

生产启动脚本：

```powershell
npm.cmd run backend:python:prod
```

## 配置

配置从根目录 `.env` 或系统环境变量读取：

```env
SERVER_PORT=8080
ARTICLE_CONTENT_DIR=./public/articles
CHATTER_CONTENT_DIR=./public/chatter
MUSIC_SOURCE=local
MUSIC_CONTENT_DIR=./music
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
WIKIPEDIA_ON_THIS_DAY_URL=https://api.wikimedia.org/feed/v1/wikipedia/zh/onthisday/all

# 网易云音乐 OpenAPI（不要提交真实值）
NETEASE_MUSIC_API_BASE_URL=https://openapi.music.163.com
NETEASE_MUSIC_PLAYLIST_ID=17434435787
NETEASE_MUSIC_APP_ID=你的应用 appId
NETEASE_MUSIC_SIGN_TYPE=RSA_SHA256
NETEASE_MUSIC_APP_SECRET=你的应用密钥
NETEASE_MUSIC_ACCESS_TOKEN=
NETEASE_MUSIC_DEVICE_JSON={"deviceType":"web","os":"web","appVer":"1.0","channel":"personal-site","model":"browser","deviceId":"air"}
NETEASE_MUSIC_BITRATE=
```

### 网易云音乐鉴权说明

博客前端不需要网易云账号登录。后端会优先使用 `NETEASE_MUSIC_ACCESS_TOKEN`；如果留空，后端会调用匿名游客登录接口，为配置的设备生成匿名 token，并只保存在当前后端进程内。服务重启后会重新获取，浏览器不会接触 `appSecret`。

这里的“匿名”是网易云的游客身份，不等于官方 OpenAPI 完全免鉴权。仍然需要网易云应用的 `appId`，并按照应用开通的 IOT 公共参数方式提供 `appSecret` 或签名配置。歌单接口返回的 `playFlag=false`、没有试听权限的歌曲不会被强行播放；全曲试听还需要网易云侧为应用开通对应的 `playlist_trial` 能力。

不要把真实 `appSecret`、`accessToken` 写进前端代码、`public/` 或 Git。`.env` 已被忽略时，只在部署服务器环境变量中配置。

Windows 本地脚本默认监听 `127.0.0.1`；生产脚本默认监听 `0.0.0.0`。本地需要局域网访问时，可以设置 `PYTHON_HOST=0.0.0.0`。

## 测试

安装开发依赖：

```bash
backend-python/.venv/bin/python -m pip install -r backend-python/requirements-dev.txt
```

运行测试：

```bash
backend-python/.venv/bin/python -m pytest backend-python/tests -q
```

# 评论与头像（新增功能）

评论使用同一个轻量 SQLite 鉴权数据库保存，不使用 PostgreSQL 或独立文件服务。公开文章和说说的评论可以匿名读取；只有登录用户可以发表评论、一级回复和删除自己的评论。评论发布后立即公开，管理员可以通过接口隐藏、恢复或删除评论。

新增配置：

```env
COMMENTS_ENABLED=true
COMMENTS_MAX_LENGTH=1000
AUTH_AVATAR_MAX_BYTES=2097152
```

接口：

```text
GET  /api/v1/articles/{slug}/comments
POST /api/v1/articles/{slug}/comments
GET  /api/v1/chatter/{slug}/comments
POST /api/v1/chatter/{slug}/comments
DELETE /api/v1/comments/{id}
GET  /api/v1/admin/comments
PATCH /api/v1/admin/comments/{id}
PUT  /api/v1/auth/me/avatar
DELETE /api/v1/auth/me/avatar
GET  /api/v1/users/{id}/avatar
```

头像只接受 PNG、JPEG 和 WebP，默认限制为 2 MiB，图片二进制直接保存到 SQLite 的 `users.avatar_data` 字段。升级旧数据库时，服务会自动增加头像字段和 `comments` 表；`backend-python/data/` 仍然需要纳入服务器备份并保持在 Git 忽略列表中。
## 后端限流

Python 后端现在包含一个单进程内存滑动窗口限流器，不使用 Redis、数据库计数或额外服务。生产脚本继续使用一个 Uvicorn worker，因此适合当前的轻量部署方式。

默认策略如下：

| 场景 | 默认限制 |
| --- | --- |
| 登录：单 IP | 5 次 / 60 秒 |
| 登录：同一用户名 | 10 次 / 10 分钟 |
| 注册：单 IP | 3 次 / 1 小时 |
| 文章/说说评论：单 IP | 20 次 / 60 秒 |
| 文章/说说评论：同一用户 | 10 次 / 60 秒 |
| 留言板：单 IP | 10 次 / 1 小时 |
| 留言板：同一用户 | 3 次 / 1 小时 |
| 更换头像：同一用户 | 5 次 / 1 小时 |
| 管理员和编辑写操作 | 60 次 / 60 秒 |
| CSRF Token 获取/写请求 | 30 次 / 60 秒 |

超过限制时返回 HTTP `429`，并携带 `Retry-After`、`X-RateLimit-Limit`、`X-RateLimit-Remaining` 和 `X-RateLimit-Reset`。错误正文仍使用统一格式：

```json
{
  "code": "RATE_LIMITED",
  "message": "请求过于频繁，请稍后再试"
}
```

### 配置

所有限流参数都可以在根目录 `.env` 中调整，示例见 `.env.example`。例如：

```env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_LOGIN_IP_MAX=5
RATE_LIMIT_LOGIN_IP_WINDOW=60s
RATE_LIMIT_COMMENT_USER_MAX=10
RATE_LIMIT_COMMENT_USER_WINDOW=60s
```

设置 `RATE_LIMIT_ENABLED=false` 可以临时关闭 Python 后端限流。关闭只影响应用层，不会关闭 Cloudflare 的边缘规则。

默认使用 `request.client.host` 作为 IP 标识，不会直接信任浏览器自行提交的 `X-Forwarded-For` 或 `CF-Connecting-IP`。只有在前面确实有受信任的反向代理时，才设置：

```env
RATE_LIMIT_TRUST_PROXY_HEADERS=true
TRUSTED_PROXY_IPS=127.0.0.1
```

如果直接让 Cloudflare 访问后端，建议把登录和注册的第一层防护放在 Cloudflare WAF，应用层继续作为后备限制；不要把后端源站直接暴露成可以绕过 Cloudflare 的入口。

Cloudflare 的规则可在 [WAF Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) 中配置。登录、注册等 API 建议返回 `429`，不使用需要 HTML 挑战页面的交互式验证；具体可用规则数量和时间窗口取决于 Cloudflare 套餐。

### 部署边界

内存限流只在当前 Python 进程内生效。将来如果启动多个 worker 或多台服务器，计数会被分散，届时应将 `rate_limit.py` 替换为 Redis 等共享存储实现；不建议把每次请求写入 SQLite，因为这会增加锁竞争和磁盘写入。
## 文章与说说的 SQLite 存储

文章和说说可以从独立 Markdown 目录迁移到与鉴权共用的 SQLite 文件。数据库模式使用 FTS5，搜索标题、摘要、标签和正文；封面图及正文图片仍保存在 `public/articles/` 或 `public/chatter/` 中。

迁移前先保持文件模式并检查内容：

```powershell
npm.cmd run content:migrate -- -DryRun
```

确认报告无误后执行迁移：

```powershell
npm.cmd run content:migrate
```

然后在根目录 `.env` 中切换：

```env
CONTENT_STORAGE=database
NEXT_PUBLIC_CONTENT_STORAGE=database
```

Linux 服务器也可以直接执行：

```bash
bash scripts/migrate-content.sh --dry-run
bash scripts/migrate-content.sh
```

脚本会读取项目根目录的 `.env`，优先使用 `backend-python/.venv/bin/python`，重复执行是安全的，不会删除原始文章、说说、封面或正文图片。

切换后公开 API 和编辑器以 SQLite 为内容来源，不再从 Markdown 文件读取正文；原目录仍会保留，作为媒体文件和离线备份。切回 `files` 即可回到旧的文件读取模式。

新增接口：

```text
GET /api/v1/search?q=关键词&type=ARTICLE|CHATTER|ALL&page=0&size=10
```
