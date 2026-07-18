# Your Space

本地文章编辑器说明见 [`docs/LOCAL-ARTICLE-EDITOR.md`](docs/LOCAL-ARTICLE-EDITOR.md)。它默认关闭，只在本机通过 `npm.cmd run editor:local` 启用。

这是一个轻量化个人博客，包含 vinext 前端和只读 API。项目同时保留 Java Spring Boot 版本，并新增了资源占用更低的 FastAPI Python 版本。

## 环境要求

- Node.js `>=22.13.0`
- Java 21
- Maven 3.9+（仅本地开发和打包需要）
- Python 3.11+（使用 Python API 时需要）

生产服务器不需要 Docker、PostgreSQL 或 Node.js 开发服务。

## 本地启动

安装前端依赖：

```powershell
npm.cmd install
```

启动只读 Java API：

```powershell
npm.cmd run backend:local
```

启动只读 Python API：

```powershell
npm.cmd run backend:python
```

Python API 使用 FastAPI，默认监听 `http://localhost:8080`。如果需要从局域网访问，可以先设置：

```powershell
$env:PYTHON_HOST = "0.0.0.0"
npm.cmd run backend:python
```

另开终端启动前端：

```powershell
npm.cmd run dev
```

前端默认地址为 `http://localhost:3000`，后端默认地址为 `http://localhost:8080`。

网易云音乐播放器使用 Python 后端的代理接口。请将 `.env.example` 中的 `NETEASE_MUSIC_*` 配置复制到本地 `.env` 并填写网易云 OpenAPI 应用参数，然后使用 `npm.cmd run backend:python` 启动后端；前端会自动读取歌单，点击播放时再获取临时播放地址。官方 OpenAPI 的密钥只放在后端环境变量中，不放入前端。

## Linux 启动

生产服务器建议只运行 Python API，前端使用静态文件托管。服务器不需要安装 Node.js、Maven、Java、Docker 或 PostgreSQL。

首次部署：

```bash
cd /opt/air
cp .env.example .env
nano .env
bash backend-python/install-linux.sh
```

启动 Python 后端：

```bash
cd /opt/air
set -a
. ./.env
set +a
backend-python/.venv/bin/uvicorn app.main:app \
  --app-dir backend-python \
  --host 127.0.0.1 \
  --port "${SERVER_PORT:-8080}" \
  --workers 1
```

测试接口：

```bash
curl http://127.0.0.1:8080/api/v1/health
curl http://127.0.0.1:8080/api/v1/articles
curl http://127.0.0.1:8080/api/v1/chatter
curl http://127.0.0.1:8080/api/v1/historical-today
```

也可以使用 systemd 托管后端，创建 `/etc/systemd/system/air-backend.service`：

```ini
[Unit]
Description=Air lightweight Python API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/air
EnvironmentFile=/opt/air/.env
ExecStart=/opt/air/backend-python/.venv/bin/uvicorn app.main:app --app-dir /opt/air/backend-python --host 127.0.0.1 --port 8080 --workers 1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启用并查看日志：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now air-backend
#sudo systemctl restart air-backend
sudo systemctl status air-backend
journalctl -u air-backend -f
```

## 静态前端部署

当前前端主要由浏览器执行页面切换、轮播图、播放器和 API 请求，适合静态部署。静态部署前端后，服务器不需要运行 `npm run dev` 或 `vinext start`，可以减少服务器内存占用。

项目已经在 [next.config.ts](next.config.ts) 中启用静态导出：

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
};

export default nextConfig;
```

在构建机器上配置生产 API 地址。若前端和后端使用同一个域名，推荐使用相对路径：

```env
NEXT_PUBLIC_API_BASE_URL=
```

如果前后端使用不同域名，则填写后端地址：

```env
NEXT_PUBLIC_API_BASE_URL=https://api.example.com
```

然后构建：

```bash
npm install
npm run build
```

项目的 `build` 命令会自动使用静态导出模式。Windows 下如果 vinext 在构建完成后输出 Node/libuv 清理断言，构建脚本会在确认 `dist/client/index.html` 已生成后将其视为可忽略的清理问题。

静态文件通常位于：

```text
dist/client/
```

该目录应包含 `index.html`、`assets/`、`articles/` 和 `chatter/`。构建机器需要 Node.js，但部署静态文件的服务器不需要 Node.js。

本地预览静态文件：

```bash
python3 -m http.server 3000 --directory dist/client
```

### Nginx 配置

将 `dist/client/` 上传到服务器，例如 `/var/www/air/dist/client`，然后配置：

```nginx
server {
    listen 80;
    server_name example.com;

    root /var/www/air/dist/client;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /music/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
    }
}
```

修改配置后检查并重载 Nginx：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

如果使用 Cloudflare Pages，构建命令填写 `npm run build`，输出目录填写 `dist/client`；`NEXT_PUBLIC_API_BASE_URL` 需要在 Cloudflare Pages 的环境变量中配置。

## 生产打包

```powershell
npm.cmd run backend:package
npm.cmd run backend:prod
```

生产启动脚本会使用受限 JVM 内存：`Xmx256m`。服务器只需要 Java 21 JRE 和 `public/` 文章目录。

## 项目结构

- `app/`：前端页面、组件和样式
- `public/articles/`：每篇文章的独立目录
- `music/`：本地音乐文件和 `playlist.json` 歌单
- `backend/`：只读 Java API
- `backend-python/`：只读 FastAPI Python API
- `scripts/`：文章目录导入导出脚本
- `worker/`：Cloudflare Worker 托管入口
- `legacy/`：旧数据库、鉴权和 Docker 方案，仅作归档

## 文章结构

```text
public/articles/first-note/
  article.json
  article.md
  cover.svg
  assets/
```

文章列表使用自动生成的 `public/articles/index.json`。正文使用 Markdown，封面支持 SVG、PNG、JPG/JPEG 和 WebP。

## 常用命令

```powershell
npm.cmd run dev              # 前端开发服务器
npm.cmd run build            # 前端构建
npm.cmd test                 # 前端测试
npm.cmd run backend:local    # 本地启动 Java API
npm.cmd run backend:python   # 本地启动 Python API
npm.cmd run backend:package  # 打包 Java JAR
npm.cmd run backend:test     # 后端测试
npm.cmd run articles:export  # 导出文章目录
npm.cmd run articles:import  # 导入文章目录
```

音乐来源默认使用本地歌单。修改根目录 `.env` 中的 `MUSIC_SOURCE`：

```env
MUSIC_SOURCE=local       # 使用 music/playlist.json
MUSIC_SOURCE=netease     # 使用网易云 OpenAPI
```

本地歌单格式和音频文件放置方式见 `music/README.md`。切换配置后需要重启 Python 后端。

详细说明请查看 [`backend/README.md`](backend/README.md) 和 [`scripts/README.md`](scripts/README.md)。
