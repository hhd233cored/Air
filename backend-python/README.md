# Python 只读后端

这是个人博客的轻量 FastAPI 后端。它不使用数据库、鉴权、Docker 或后台管理功能，文章直接从项目的 `public/articles/` 目录读取。

## 接口

```text
GET /api/v1/health
GET /api/v1/articles
GET /api/v1/articles/{slug}
GET /api/v1/historical-today
```

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
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
WIKIPEDIA_ON_THIS_DAY_URL=https://api.wikimedia.org/feed/v1/wikipedia/zh/onthisday/all
```

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
