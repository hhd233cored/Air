# Java 后端

这是个人网站的 Spring Boot 后端，使用 Java 21、Spring Data JPA、Flyway 和 PostgreSQL。Windows 本地开发也支持使用 H2 文件数据库，不依赖 Docker。

## 本地运行

### Windows 本地模式（不使用 Docker）

需要先安装 Java 21 和 Maven 3.9+，然后在项目根目录执行：

```powershell
npm.cmd run backend:local
```

该命令会使用 `local` profile 和 H2 文件数据库，数据库文件保存在 `backend/data/`。首次启动时会执行 Flyway 迁移并写入示例文章，重复启动不会重复插入。

前端另开一个终端运行：

```powershell
npm.cmd run dev
```

后端地址：`http://localhost:8080`

健康检查：`http://localhost:8080/api/v1/health`

Swagger UI：`http://localhost:8080/swagger-ui.html`

### Docker 模式

如果已安装 Docker，可以在项目根目录执行：

```powershell
docker compose up --build
```

该模式使用 PostgreSQL，并通过 Docker 卷持久化数据库数据。

## Maven 未加入 PATH

如果 Maven 已安装但命令无法找到，可以在当前 PowerShell 窗口临时添加：

```powershell
$env:Path += ";C:\tools\apache-maven-3.9.16\bin"
mvn -version
```

也可以在 IDE 中使用 `local` profile 启动 `com.yourspace.YourSpaceApplication`。

## 目录说明

- `src/main/java/com/yourspace/article/`：文章实体、控制器、服务、仓库和 DTO
- `src/main/java/com/yourspace/common/`：分页、错误响应和健康检查
- `src/main/resources/db/migration/`：PostgreSQL 的 Flyway 数据库迁移
- `src/main/resources/db/migration-h2/`：H2 本地模式的数据库迁移
- `src/test/`：后端单元测试和集成测试

当前暂未接入鉴权，写入接口仅适合本地使用。部署到公网前需要增加 Spring Security 和管理权限。
