# 鉴权使用说明

当前后端使用 Spring Security、BCrypt 和服务端 Session。

## 账号初始化

在项目根目录 `.env` 中配置：

```env
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD=请替换为管理员密码
AUTH_USER_USERNAME=reader
AUTH_USER_PASSWORD=请替换为普通用户密码
AUTH_SESSION_COOKIE_SECURE=false
AUTH_SESSION_COOKIE_SAME_SITE=lax
AUTH_SESSION_TIMEOUT=7d
```

`npm.cmd run backend:local` 会读取根目录 `.env`，首次启动时创建不存在的账号。已经存在的账号不会被环境变量覆盖。密码只以 BCrypt 哈希形式保存。

不要把真实密码提交到 Git。`.env` 已经被忽略，提交前请确认 `git status` 没有显示它。

## 接口

```text
GET  /api/v1/auth/csrf
POST /api/v1/auth/login
GET  /api/v1/auth/me
POST /api/v1/auth/logout
```

登录请求：

```json
{
  "username": "admin",
  "password": "your-password"
}
```

登录成功后，浏览器会收到 HttpOnly Session Cookie。前端写请求还需要携带 `X-XSRF-TOKEN` 请求头。

公开文章读取接口不需要登录。创建、修改、发布、归档和删除文章必须使用管理员账号。普通用户目前只有登录身份，没有额外写入权限。

## PowerShell 导入文章

导入脚本会自动获取 CSRF Token 并登录管理员：

```powershell
$env:AUTH_ADMIN_USERNAME = "admin"
$env:AUTH_ADMIN_PASSWORD = "your-password"
powershell -ExecutionPolicy Bypass -File scripts/import-articles.ps1 -UpdateExisting -Publish
```

也可以直接传入参数：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/import-articles.ps1 -Username admin -Password "your-password" -Publish
```

## Swagger

打开 `http://localhost:8080/swagger-ui.html` 查看接口。登录接口产生的 Cookie 适用于浏览器调用；PowerShell 或 Postman 调用写接口时，需要同时保存 Session Cookie 和 CSRF Token。
