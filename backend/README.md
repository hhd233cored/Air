# Backend

后端代码统一放在这里，保持前端 `app/` 与服务端逻辑分开。

## 目录约定

- `api/`：后续的 API 路由、参数校验和业务入口
- `db/`：Drizzle 数据库连接和正式数据库 schema
- `services/`：可复用的业务服务，例如文章、音乐和天气服务
- `lib/`：后端内部工具和适配器

当前项目使用 Cloudflare Worker 作为运行入口，入口文件仍保留在根目录的 `worker/index.ts`。新增后端功能时，尽量让 Worker 负责请求分发，让具体业务代码放在本目录中。
