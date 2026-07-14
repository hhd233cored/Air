# Your Space

这是一个个人网站项目，包含 vinext 前端和独立的 Java Spring Boot 后端。

## 环境要求

- Node.js `>=22.13.0`
- Java 21
- Maven 3.9+
- Docker（可选，Windows 本地开发可以不使用）

## 快速启动

安装前端依赖：

```powershell
npm.cmd install
```

启动 Java 后端（Windows 本地模式，使用 H2 文件数据库）：

```powershell
npm.cmd run backend:local
```

另开终端启动前端：

```powershell
npm.cmd run dev
```

前端默认地址为 `http://localhost:3000`，后端默认地址为 `http://localhost:8080`。

如果使用 Docker，也可以执行：

```powershell
docker compose up --build
```

## 项目结构

- `app/`：前端页面、组件和样式
- `public/`：静态资源和 Markdown 示例文章
- `backend/`：Java Spring Boot 后端、实体和数据库迁移
- `scripts/`：文章 Markdown 与封面图的导入导出脚本
- `worker/`：Cloudflare Worker 托管入口

## 文章数据

文章元数据和 Markdown 正文保存在数据库中，封面使用 `coverUrl` 保存地址。前端优先从 Java API 获取文章，后端不可用时会回退到 `public/articles/first-note.md` 示例文件。

文章导入导出说明请查看 [`scripts/README.md`](scripts/README.md)，后端说明请查看 [`backend/README.md`](backend/README.md)。

## 常用命令

```powershell
npm.cmd run dev              # 启动前端开发服务器
npm.cmd run build            # 构建前端
npm.cmd test                 # 运行前端检查
npm.cmd run backend:local    # 启动 Windows 本地后端
npm.cmd run articles:export  # 导出文章、Markdown 和封面
npm.cmd run articles:import  # 导入文章和封面
```

当前后端尚未接入鉴权，写入接口仅用于本地开发。部署到公网前需要增加认证和权限控制。
