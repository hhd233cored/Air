# Python 只读后端

这是个人博客的轻量 FastAPI 后端。它不使用数据库、鉴权、Docker 或后台管理功能，文章直接从项目的 `public/articles/` 目录读取。

## 接口

```text
GET /api/v1/health
GET /api/v1/articles
GET /api/v1/articles/{slug}
GET /api/v1/historical-today
GET /api/v1/music/playlist
GET /api/v1/music/tracks/{songId}/url
GET /api/v1/music/tracks/{songId}/cover
```

音乐来源由 `MUSIC_SOURCE` 控制，默认是本地音乐：

```env
MUSIC_SOURCE=local
MUSIC_CONTENT_DIR=./music
```

切换为网易云歌单：

```env
MUSIC_SOURCE=netease
```

本地音乐放在 `music/` 目录，歌单文件为 `music/playlist.json`。JSON 只保存歌曲 `id` 和 `name`，标题、作者、专辑、时长和内嵌封面由 `mutagen` 从音频文件读取。后端只返回歌曲元数据和音频 URL，音频文件由 `/music/` 静态路径提供。

接口路径和响应结构与 `backend/` 中的 Java 版本保持一致，切换后前端不需要修改 API 适配层。

## Linux 一键安装

在项目根目录执行：

```bash
bash backend-python/install-linux.sh
```

脚本会检查 Python 3.11+，创建 `backend-python/.venv`，并安装运行依赖。它不会修改系统 Python，也不会安装数据库或 Docker。

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

Java 版本仍保留在 `backend/`，可继续使用原来的 Maven 命令。
