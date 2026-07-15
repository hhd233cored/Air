# Your Space

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

## 生产打包

```powershell
npm.cmd run backend:package
npm.cmd run backend:prod
```

生产启动脚本会使用受限 JVM 内存：`Xmx256m`。服务器只需要 Java 21 JRE 和 `public/` 文章目录。

## 项目结构

- `app/`：前端页面、组件和样式
- `public/articles/`：每篇文章的独立目录
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

详细说明请查看 [`backend/README.md`](backend/README.md) 和 [`scripts/README.md`](scripts/README.md)。
