# Java 只读后端

这是个人博客的轻量化 Spring Boot API，使用 Java 21 和本地文章文件，不连接数据库。

## 保留接口

```text
GET /api/v1/health
GET /api/v1/articles
GET /api/v1/articles/{slug}
GET /api/v1/historical-today
```

文章元数据从 `ARTICLE_CONTENT_DIR` 指向的目录读取，默认是项目根目录下的 `public/articles/`。历史上的今天只在内存中缓存当天数据，每个整点最多请求一次 Wikimedia API。

## Windows 本地启动

需要 Java 21 和 Maven 3.9+：

```powershell
npm.cmd run backend:local
```

健康检查：`http://localhost:8080/api/v1/health`

如果 Maven 没有加入 PATH：

```powershell
$env:Path += ";C:\tools\apache-maven-3.9.16\bin"
mvn -version
```

## 生产运行

先在有 Maven 的环境打包：

```powershell
npm.cmd run backend:package
```

服务器只需要 Java 21 JRE。可以运行：

```powershell
npm.cmd run backend:prod
```

默认 JVM 限制为：

```text
-Xms64m -Xmx256m -XX:MaxMetaspaceSize=128m -XX:+UseSerialGC
```

可通过 `ARTICLE_CONTENT_DIR` 指定文章目录，通过 `SERVER_PORT` 指定端口。

## 文章目录

```text
public/articles/
  index.json
  first-note/
    article.json
    article.md
    cover.svg
    assets/
```

后端只返回 `status` 为 `PUBLISHED` 的文章，按发布时间倒序排列。详情接口返回 Markdown 原文和封面 URL。

数据库、鉴权、Docker 和旧测试代码已归档到根目录 `legacy/`，不参与当前 Maven 构建。
