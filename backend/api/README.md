# API 说明

文章接口位于 `src/main/java/com/yourspace/article/controller/ArticleController.java`，统一使用 `/api/v1/articles` 前缀。

## 常用接口

```text
GET    /api/v1/health
GET    /api/v1/articles
GET    /api/v1/articles/{slug}
POST   /api/v1/articles
PUT    /api/v1/articles/{id}
DELETE /api/v1/articles/{id}
POST   /api/v1/articles/{id}/publish
POST   /api/v1/articles/{id}/archive
```

Swagger UI：`http://localhost:8080/swagger-ui.html`

当前接口未接入鉴权，仅建议在本地通过 Swagger、curl 或 Postman 使用写入接口。
