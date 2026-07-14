# Java Backend

这是个人网站的 Spring Boot 后端，使用 Java 21、PostgreSQL、JPA 和 Flyway。

## 本地运行

在项目根目录执行：

```bash
docker compose up --build
```

后端地址为 `http://localhost:8080`，健康检查为 `/api/v1/health`，Swagger UI 为 `/swagger-ui.html`。

首次启动或已有数据库升级时，Flyway 会执行示例数据迁移，写入 5 篇已发布的示例文章。重复启动不会重复插入。

## 目录约定

- `src/main/java/com/yourspace/article/`：文章领域的实体、接口、服务和仓储
- `src/main/java/com/yourspace/common/`：分页、错误响应和健康检查
- `src/main/resources/db/migration/`：Flyway 数据库迁移
- `src/test/`：后端单元测试和集成测试

当前不接入鉴权，写接口只用于本地 Swagger、curl 或 Postman。部署到公网前必须增加 Spring Security 和管理员权限。
