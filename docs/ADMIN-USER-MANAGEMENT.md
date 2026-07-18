# 管理员账号管理

账号管理直接使用 Python 后端现有的 SQLite 鉴权数据库，不需要启动新的服务。

## 页面入口

管理员登录后，点击导航栏右侧的用户头像，在用户面板中选择“账号管理”。页面地址为：

```text
/admin
```

普通用户和未登录用户即使直接访问 `/admin`，也不能读取用户列表；后端会返回 `401` 或 `403`。

## 管理功能

- 查看账号、角色、启用状态、头像和创建时间
- 按用户名搜索
- 按角色和启用状态筛选
- 创建 `USER` 或 `ADMIN` 账号
- 修改角色
- 启用或停用账号
- 重置密码
- 上传或清除用户头像

用户名创建后不可修改。账号不做物理删除，只能停用，这样不会破坏文章评论、说说评论和留言板中的历史关联。

管理员不能停用或降级自己，也不能停用或降级最后一个启用中的管理员。停用账号、修改角色或重置密码后，该账号的旧 Session 会被撤销。

## API

列表：

```text
GET /api/v1/admin/users?page=0&size=20
GET /api/v1/admin/users?query=reader&role=USER&enabled=true
```

创建：

```powershell
Invoke-RestMethod "$env:API_BASE/api/v1/admin/users" `
  -Method Post `
  -WebSession $session `
  -Headers @{ "X-XSRF-TOKEN" = $csrf } `
  -ContentType "application/json" `
  -Body '{"username":"reader-2","password":"change-me-123","role":"USER","enabled":true}'
```

修改角色或状态：

```text
PATCH /api/v1/admin/users/{id}
```

请求体示例：

```json
{
  "role": "ADMIN",
  "enabled": true
}
```

重置密码：

```text
POST /api/v1/admin/users/{id}/reset-password
```

请求体：

```json
{
  "password": "new-password-123"
}
```

头像接口：

```text
PUT    /api/v1/admin/users/{id}/avatar
DELETE /api/v1/admin/users/{id}/avatar
```

所有写请求都需要管理员 Session 和 `X-XSRF-TOKEN` 请求头。密码只以 Argon2id 哈希形式保存，API 永远不会返回密码、密码哈希或 Session Token。

## 控制公开注册

管理员可以在 `/admin` 页面中切换公开注册开关，也可以调用：

```text
GET   /api/v1/admin/settings/registration
PATCH /api/v1/admin/settings/registration
```

修改请求体：

```json
{"enabled": false}
```

关闭后，公开注册接口会拒绝新账号注册；已有账号和管理员创建账号的功能不受影响。`.env` 中的 `AUTH_REGISTRATION_ENABLED` 只作为数据库首次初始化时的默认值，之后以 SQLite 中保存的管理员设置为准。

## 启动要求

确保后端启用了鉴权，并配置了管理员账号：

```env
AUTH_ENABLED=true
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD=change-this-password
AUTH_DATABASE_PATH=./backend-python/data/auth.sqlite3
```

本地启动：

```powershell
npm.cmd run backend:python
npm.cmd run dev
```

编辑器使用 `npm.cmd run editor:local` 时，会继续复用同一个 SQLite 数据库和管理员账号。
