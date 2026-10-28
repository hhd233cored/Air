# AirChord Spring Boot 后端：阶段 0–5 与 RabbitMQ 音频导入试点

`backend-spring/` 是新的 Java 后端学习项目。Python/FastAPI 与现有 SQLite 保持原样并继续作为行为参照；Spring Boot 连接独立 PostgreSQL，并使用 Redis 保存登录 session 与公开详情缓存。当前实现覆盖公开读取、搜索、登录鉴权、互动、管理员账号、限流、内容编辑器和本地音乐管理。**SQLite 数据复制暂缓**，Java 不会读取、修改或覆盖 Python SQLite 文件。

## 本机要求

- JDK 21
- Docker Desktop（提供 Docker Compose）
- Windows PowerShell 可使用 `run-local.ps1`；Maven Wrapper 固定 Maven 3.9.16。

项目使用 Spring Boot 4.1.1、Spring MVC、Spring Security、Spring Session、Spring JDBC、Spring Data Redis、Flyway、PostgreSQL 18.6、Redis 8.4 和 RabbitMQ。JDBC 仓储中的 SQL 是显式可读的，Flyway 负责按版本记录数据库结构变化；缓存采用显式 Cache-Aside 代码，认证则由 Spring Security 与 Redis session 管理。RabbitMQ 分别处理异步音频导入与文章指标事件，两种业务使用不同队列。

## 启动

### 用 Docker Compose 启动整套 Java 后端

在 PowerShell 中执行一次启动命令即可构建并运行 Java、PostgreSQL、Redis 和 RabbitMQ：

```powershell
Set-Location backend-spring
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# 编辑 .env，为本机 PostgreSQL 与 RabbitMQ 设置各自的专用密码
docker compose --env-file .env up --build -d --wait
```

Docker Desktop 必须显示 Engine 已运行。Windows 上如果提示未检测到虚拟化，需在 BIOS/UEFI 中启用 CPU 虚拟化，并启用 WSL 2 所需的 Windows 功能后重启；见[Docker Desktop Windows 要求](https://docs.docker.com/desktop/setup/install/windows-install/)和[微软 WSL 安装说明](https://learn.microsoft.com/en-us/windows/wsl/install)。

Java 服务监听 `http://localhost:8081`；Python/FastAPI 如需并行运行，仍可在宿主机监听 `http://localhost:8080`。Compose 网络内，Java 使用 `postgres:5432`、`redis:6379` 和 `rabbitmq:5672` 连接依赖；宿主机仍可通过 `localhost:5433` 连接 PostgreSQL。RabbitMQ 管理界面为 `http://localhost:15672`。数据库与消息代理密码只从未提交的 `.env` 读取。已有 `.env` 的用户需补上 `RABBITMQ_PASSWORD`。

查看 Java 容器日志并检查健康接口：

```powershell
docker compose --env-file .env logs -f app
Invoke-RestMethod http://localhost:8081/api/v1/health
```

停止容器但保留 PostgreSQL 数据卷：

```powershell
docker compose --env-file .env down
```

### 在宿主机运行 Java（学习/调试模式）

也可以只用 Docker 运行 PostgreSQL、Redis 和 RabbitMQ，再由本机 JDK 启动 Java：

```powershell
Set-Location backend-spring
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# 编辑 .env，为本机 PostgreSQL 设置专用密码
.\run-local.ps1
```

脚本会读取 `backend-spring/.env`、只启动 PostgreSQL、Redis 和 RabbitMQ，再运行 Java 服务。依赖容器已经运行时，可使用 `.\run-local.ps1 -SkipDatabaseStart` 直接启动 Java。Redis 与 RabbitMQ 端口仅绑定本机回环地址；Redis 缓存不启用磁盘持久化。

健康检查：

```powershell
Invoke-RestMethod http://localhost:8081/api/v1/health
```

## 公开读取与搜索接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/v1/health` | 返回 `{"status":"UP"}` |
| `GET /api/v1/articles?page=0&size=10&tag=...&q=...` | 已发布文章分页，可按标签及关键词筛选 |
| `GET /api/v1/articles/{slug}` | 已发布文章详情，包含 `contentMarkdown` |
| `GET /api/v1/articles/{slug}/stats` | 浏览数、点赞数及当前账号是否已点赞 |
| `POST /api/v1/articles/{slug}/views` | 接收一次浏览事件，返回 202；要求 UUID `Idempotency-Key` 请求头 |
| `PUT` / `DELETE /api/v1/articles/{slug}/like` | 登录用户点赞或取消点赞；要求 Session 与 CSRF token |
| `GET /api/v1/chatter?page=0&size=10&q=...` | 已发布说说分页与关键词筛选 |
| `GET /api/v1/chatter/{slug}` | 已发布说说详情，包含 `contentMarkdown` |
| `GET /api/v1/search?q=Spring&type=ALL&page=0&size=10` | 跨文章与说说搜索；`type` 可取 `ARTICLE`、`CHATTER` 或 `ALL` |
| `/articles/**`、`/chatter/**`、`/music/**` | 从配置的资源目录提供封面、正文图片和本地音乐 |

列表页码从 0 开始；每页 `size` 取 1–50。草稿、归档和软删除记录不会出现在公开列表或详情中，详情按 404 处理。返回分页字段、camelCase DTO 字段与 Python 接口对齐。非法分页参数和未知资源返回统一 JSON 错误。

搜索的 `q` 必填，长度最多 100；类型缺省为 `ALL`，页码和每页条数与列表一致。PostgreSQL 用 `search_document` 生成列和 GIN 索引处理全文匹配，用 `search_literal_lc` 和 `pg_trgm` GIN 索引处理不区分大小写的字面包含匹配。两个条件仍取并集，中文连续子串、标点和 `%`、`_` 等字符仍按原有字面规则搜索。`search_literal_lc` 由数据库触发器在内容写入时更新；搜索 SQL 不再为每一行现场拼接和小写化正文。公开搜索的部分索引只收录已发布、未软删除的内容；`ALL` 类型不附加类型条件。响应的 `preview` 在编辑时从 Markdown 生成并持久化；列表和搜索仅读取预览，不向 JVM 传输整篇正文，详情仍返回完整正文。文章封面仍需通过静态文件存在性检查。

搜索分页仍先查询总数、再读取当前页，排序和返回字段不变。短于三个字符的词、非常常见的词，或匹配大量记录的词仍可能由 PostgreSQL 选择全表扫描；是否使用索引应以 `EXPLAIN (ANALYZE, BUFFERS)` 和实际数据为准。迁移 `V1002` 会为已有内容回填搜索文本并建立索引，首次执行时间与正文总量有关。数据库用户需要有安装 `pg_trgm` 扩展的权限；本项目 Docker PostgreSQL 的初始化用户具备所需权限。

### 文章浏览与点赞

页面展示已发布文章时，前端生成一次 UUID 并提交浏览事件；同一事件重试不会再计数。点赞采用 `PUT`，取消采用 `DELETE`；`(article_id, user_id)` 数据库唯一键确保同一用户最多保留一条点赞关系。`POST /views` 与点赞响应中的 `changed` 表示本次是否真正改变事实记录。`GET /stats` 返回 `{viewCount,likeCount,likedByMe,updatedAt}`；前两项是异步统计，短时间内可能落后于写入，`likedByMe` 则直接查询当前用户的点赞关系。未登录用户能浏览和查看统计，但不能点赞。草稿、归档和已删除文章的指标接口返回 404。

每次有效写入在同一个 PostgreSQL 事务中保存事实与 outbox 事件。发布器发送只含事件 ID 的持久化消息，收到 RabbitMQ Confirm 且没有 Return 才标记已发布；没有确认会从 outbox 重试。消费者默认每批最多 100 条、聚批最多等待 100 ms，批量读取 outbox，把首次处理标记与按文章合并的一条统计 UPSERT 放在同一事务；提交后收集本批唯一文章缓存键，一次 Redis DEL 删除，再逐条手动 ACK。批次失败时有效消息重新入队，重复投递不会重复计数；坏消息和不存在的事件进入死信队列。点赞消息即使乱序，也从当前点赞关系每篇文章重算一次，纯浏览更新保留已有点赞数。ARTICLE_METRIC_CONSUMER_BATCH_SIZE 可设为 1–200（设为 1 可对照），ARTICLE_METRIC_CONSUMER_BATCH_WAIT_MS 可设为 1–1000。Redis 只缓存计数快照，消费提交后删除该缓存；删除故障记录失败调用数与受影响文章数，旧快照仍受 30–35 秒 TTL 限制。Redis 丢失不会丢失点赞关系或浏览事实。文章详情缓存不会因计数变化而失效。新迁移 `V1003` 建立事实、统计、outbox 与已处理事件表。指标使用独立的持久化队列和死信队列，队列最大长度 20000；RabbitMQ 不可用时，已接受事件留在 PostgreSQL outbox 中。

发布器每批最多领取 200 条，逐条检查 Confirm 和 Return 后，调用 `markPublishedBatch(List<UUID>)` 用一条 UPDATE、一个短事务标记成功事件；等待消息确认时不持有数据库事务。标记失败时保留未发布状态，原有 30 秒租约到期后可重新领取。发送或确认失败仍单独延期；延期更新失败也由原租约保证可重试。批量接口对空列表直接返回，对已经发布的事件不重复更新。

发布器支持有界连续发布：`ARTICLE_METRIC_PUBLISHER_MAX_BATCHES` 默认 1、范围 1–10；设为 4 时，满 200 条且整批成功才连续领取下一批。`ARTICLE_METRIC_PUBLISHER_RUN_BUDGET_MS` 默认 250 ms，用于下一批准入，已领取事件仍完成确认与标记。整批 future 共用发送结束后的 5 秒确认窗口。单文章与多文章复测见 [连续发布对照](perf/RESULTS-ARTICLE-METRICS-PUBLISHER-DRAIN-2026-09-26.md)。

多文章统计 SQL 与 Redis 删除批量化、回滚/防重验证及同条件对照见 [消费者批量往返记录](perf/RESULTS-ARTICLE-METRICS-CONSUMER-BULK-2026-09-26.md)。

压测可额外开启 `AIRCHORD_PERF_JDBC_ENABLED=true`，记录 HTTP 连接持有、JDBC SQL 执行和直接 commit，默认关闭；需原 perf timing 开关及请求头同时开启。口径、开关校验与结果见 [HTTP JDBC 拆测](perf/RESULTS-ARTICLE-METRICS-HTTP-JDBC-2026-09-26.md)。

本地排查可在 RabbitMQ 管理页面查看 `airchord.article.metrics.q` 的 ready/unacked 数量，或查询 `article_metric_outbox` 中 `published_at IS NULL` 的事件。计数会最终收敛；不能以点赞写接口刚返回时的 `/stats` 数值判断事件是否丢失。隔离的 5000 用户压测脚本与结果记录见 [压测说明](perf/README.md)。

### 内存与重复读取优化

- 头像上传在调用 `getBytes()` 之前检查文件大小，超过头像上限立即返回 413。
- Java Flyway 迁移 `V1000__Backfill_content_previews` 按游标批量读取历史正文并逐条回填预览，不修改正文和更新时间。版本号排在已有 V900/V901 本地夹具之后，以兼容已运行这些夹具的数据库；后续版本迁移从 V1001 开始。
- 静态 `index.json` 仅查询已发布且未删除的摘要，以 100 行游标批次逐条写临时文件后原子替换；失败保留旧索引并清理临时文件。同一进程内每种内容类型的索引重建串行执行。
- 音乐目录每次请求构建文件名索引，保留外部文件变动的可见性；音频元数据使用最多 256 项的 LRU 缓存，按真实路径、文件大小、修改时间和文件标识失效。缓存不持有音频标签对象或封面字节；仅封面接口提取封面字节。首次解析音频时，标签库本身仍可能读取内嵌图片。
- 限流桶按到期时间清理，请求到来时清理已到期桶，空闲时每分钟清理一次。容量满且没有过期桶时，新 key 返回 429，已有 key 的滑动窗口计数继续保留；不再全表扫描和淘汰活跃记录。

无数据库回归测试：`./mvnw.cmd "-Dtest=!BaselineIntegrationTest,!ContentMemoryIntegrationTest" test`。
数据库专项测试设置 `AIRCHORD_TEST_JDBC_URL`、`AIRCHORD_TEST_DB_USER`、`AIRCHORD_TEST_DB_PASSWORD` 后运行 `./mvnw.cmd -Dtest=ContentMemoryIntegrationTest,SearchSqlIntegrationTest test`。两个测试分别在所选 PostgreSQL 数据库中创建并最终删除随机测试 schema，验证迁移、列表投影、提交后的流式索引，以及搜索改造前后的结果和分页一致性；账号需具有创建 schema 的权限，不需要 Redis。

## 登录与权限

| 接口 | 行为 |
| --- | --- |
| `GET /api/v1/auth/csrf` | 建立匿名 session，返回 `{ "token": "..." }` 并设置 `XSRF-TOKEN` 兼容 Cookie |
| `POST /api/v1/auth/register` | 公开注册为普通 `USER`，成功返回 201 并自动登录 |
| `POST /api/v1/auth/login` | 验证账号密码，成功建立登录 session |
| `POST /api/v1/auth/logout` | 校验 CSRF 后销毁 session，返回 204 |
| `GET /api/v1/auth/me` | 返回当前登录用户；匿名访问返回统一 401 JSON |
| `PUT /api/v1/auth/me/avatar`、`DELETE /api/v1/auth/me/avatar` | 更新或删除当前用户头像；仅接受 PNG/JPEG/WebP，默认上限 2 MiB |
| `GET /api/v1/users/{id}/avatar` | 公开读取头像，返回正确媒体类型和 `nosniff` 响应头 |

浏览器只持有名为 `air_session` 的随机 session ID Cookie，Cookie 设置 `HttpOnly`；Spring Session 把 `SecurityContext` 和 session 属性存入 Redis。Spring Boot 4 使用 `spring.session.data.redis.*` 配置；这里选择 `indexed` 仓储，使管理员可以按用户名查找并撤销 session。CSRF token 由 `HttpSessionCsrfTokenRepository` 保存为 session 属性，也落在 Redis；`XSRF-TOKEN` Cookie 是为兼容现有客户端保留的可读镜像，服务端授权校验不信任它，而是把 `X-XSRF-TOKEN` 请求头与 session 中的 token 比较。登录成功后会轮换 session ID 并清除旧 token；前端在下一次写请求前重新请求 `/auth/csrf`。

默认 session 时限为 7 天：Redis 同时设置 7 天空闲过期，认证过滤器还按创建时间检查绝对期限，以保持 Python 参照中的固定有效期。每个认证请求都会重新读取 PostgreSQL 用户状态；账号被禁用或角色发生变化时，当前 session 会失效。Redis 无法提供 session 时认证失败关闭，不会像公开内容缓存那样回退到 PostgreSQL。

用户密码哈希保存在 PostgreSQL，使用 Argon2id；明文密码不会写入数据库或 Redis session。公开注册开关首次启动时从 `AUTH_REGISTRATION_ENABLED` 初始化到 `auth_settings`，之后以数据库值为准。可在 `.env` 中取消注释并设置 `AUTH_ADMIN_USERNAME` 与 `AUTH_ADMIN_PASSWORD`，由启动器创建本地管理员；普通账号可通过注册接口创建。已存在的引导账号不会在重启时被覆盖。`demo-admin` 和 `demo-reader` 是接口参照夹具，密码哈希无效，不能登录。

Spring Security 将 `USER`、`ADMIN` 映射为 `ROLE_USER`、`ROLE_ADMIN`。`/api/v1/admin/**` 与 `/api/v1/editor/**` 为管理员专属路径；其他未明确公开的请求默认需要登录。

CORS 只允许 `CORS_ALLOWED_ORIGINS` 中列出的源携带 Cookie。生产环境应设置 `AUTH_COOKIE_SECURE=true`；只有确实需要跨站前端访问时才设置 `AUTH_COOKIE_SAMESITE=None`，并同时使用 HTTPS。登录、注册、评论、留言板、头像、管理操作和 CSRF 获取已有首版速率限制。

## 评论、留言板与管理员

| 接口 | 行为 |
| --- | --- |
| `GET/POST /api/v1/articles/{slug}/comments`、`/api/v1/chatter/{slug}/comments` | 公开只读可见评论；登录用户写入；允许回复一级评论 |
| `DELETE /api/v1/comments/{id}` | 评论作者或管理员软删除 |
| `GET/POST /api/v1/guestbook/messages`、`DELETE /api/v1/guestbook/messages/{id}` | 独立留言表；可见留言倒序分页；不支持回复 |
| `GET /api/v1/admin/comments`、`PATCH /api/v1/admin/comments/{id}` | 管理员分页查询并设置 `VISIBLE`、`HIDDEN`、`DELETED` |
| `GET/POST /api/v1/admin/users`、`PATCH /api/v1/admin/users/{id}` | 筛选/创建用户、设置角色和启用状态 |
| `POST /api/v1/admin/users/{id}/reset-password` | 管理员重置密码 |
| `PUT/DELETE /api/v1/admin/users/{id}/avatar` | 管理员维护头像；头像上限 2 MiB |
| `GET/PATCH /api/v1/admin/settings/registration` | 查询或持久化公开注册开关 |

最后一位启用管理员不能被降权或禁用；当前管理员不能修改自己的角色或启用状态。权限/启用状态变化及重置密码会在 PostgreSQL 事务提交后，通过 Spring Session 主体索引撤销该用户名的 Redis sessions；`security_version` 还会在每个认证请求中校验，因此 Redis 短暂不可用时，旧权限或旧密码建立的 session 也会失效。评论只允许回复同一目标下可见的顶层评论；公开查询会隐藏状态非 `VISIBLE` 的内容和被隐藏父评论的回复。

限流是有界内存滑动窗口，默认值对齐 Python：登录 IP 5 次/分钟、用户名 10 次/10 分钟、注册 IP 3 次/小时、评论 IP/用户 20/10 次/分钟、留言 IP/用户 10/3 次/小时、头像用户 5 次/小时、管理 IP/用户 60 次/分钟、CSRF IP 30 次/分钟。429 响应带 `Retry-After` 和 `X-RateLimit-*`。默认只使用 TCP 连接来源 IP；仅当启用 `RATE_LIMIT_TRUST_PROXY_HEADERS=true` 且来源 IP 列在 `TRUSTED_PROXY_IPS` 时才读取 `CF-Connecting-IP`/`X-Forwarded-For`。此版本为单个 Java 进程计数，多实例运行时应改用 Redis 原子限流。

## 内容编辑器与图片文件

编辑器默认关闭：在 `.env` 设置 `EDITOR_ENABLED=true` 后，只有管理员能访问：

- `GET/POST /api/v1/editor/articles`、`GET/PUT/DELETE /api/v1/editor/articles/{slug}`
- `GET/POST /api/v1/editor/chatter`、`GET/PUT/DELETE /api/v1/editor/chatter/{slug}`

文章表单使用 `title`、`slug`/`newSlug`、`summary`、`tags`、`status`、`publishedAt`、`contentMarkdown`、`cover` 和多值 `assets`；说说表单使用 `slug`/`newSlug`、`status`、`publishedAt`、`contentMarkdown` 和 `assets`。状态允许 `DRAFT`、`PUBLISHED`、`ARCHIVED`。文章必须有 SVG/PNG/JPG/JPEG/WebP 封面；正文资源另允许 GIF。Slug 只能由小写字母、数字和单个连字符组成；已发布、已归档或有评论的内容不能改 Slug。发布时未传 `publishedAt` 会自动补当前 UTC 时间。

PostgreSQL 是编辑器正文与元数据主存储；每条文章或说说还在配置目录写 `article.md`/`chatter.md` 和 JSON 元数据，上传媒体在对应目录内。文件先写临时目录并通过目录重命名替换；数据库回滚时恢复原目录，提交后清理备份和更新静态索引。详情缓存失效事件只在数据库事务提交后触发。单次编辑器 multipart 请求总量上限为 **100 MiB**（由 `EDITOR_UPLOAD_MAX_BYTES` 控制并受 Servlet multipart 上限约束）。Compose 将文章、说说目录改为可写挂载；如果应用容器只读挂载这些目录，读接口仍可用，编辑器写入会失败。

## 本地音乐

当前只实现 `MUSIC_SOURCE=local`，外部网易云服务留到第 6 阶段：

- `GET /api/v1/music/playlist` 返回 `playlist.json` 中可定位到的本地音频；缺文件的条目会跳过。
- `GET /api/v1/music/tracks/{id}/url` 返回容器内静态目录下的播放 URL；`/music/**` 由 Spring 静态资源处理器从 `MUSIC_CONTENT_DIR` 提供。
- `GET /api/v1/music/tracks/{id}/cover` 返回内嵌封面，带一天的公开缓存头。
- 管理员可通过 `GET/POST /api/v1/admin/music/tracks` 管理歌单，用 `DELETE /api/v1/admin/music/tracks/{id}` 删除。
- `POST /api/v1/admin/music/import-jobs` 接收相同的 `audio` multipart 字段，返回 `202`、`Location` 和 `{id,status,createdAt}`；`GET /api/v1/admin/music/import-jobs/{id}` 查询 `{id,status,trackId,errorCode,createdAt,updatedAt}`。任务状态为 `PENDING`、`RUNNING`、`SUCCEEDED`、`FAILED`，客户端可每 2 秒查询一次。

Jaudiotagger 尝试读取标题、艺人、专辑、时长和内嵌封面；不支持的编码（例如部分 WebM）会回退到文件名和空元数据，不会阻止歌曲进入歌单。音频只接受 `.mp3/.m4a/.aac/.wav/.ogg/.flac/.webm`，默认单文件上限 50 MiB。歌单更新先原子替换 `playlist.json`，上传失败时清除新文件；媒体文件与歌单都保存在 `MUSIC_CONTENT_DIR`，Compose 默认可写挂载仓库 `music/`。

异步导入只向 RabbitMQ 发送版本号和任务 ID；音频先保存到独立私有卷，不能通过 `/music/**` 下载。PostgreSQL 在同一事务保存任务与 outbox 事件；RabbitMQ 暂时不可用时，发布器会继续重试。消费者同时只处理一个任务，最多处理三次，最终失败的消息进入死信队列。收到重复消息时，预先分配的 `trackId` 用于避免重复添加歌单项。现有同步上传接口及前端行为不变。Python 服务可以读取歌单，但两套后端不能同时写 `music/playlist.json`。

默认最多接受 20 个未完成任务和 1 GiB 暂存音频；超过任一限制返回 `503`、`MUSIC_IMPORT_BUSY` 和 `Retry-After: 30`。成功任务立即清理暂存文件；失败文件保留七天，孤立文件在一天后清理。`MUSIC_IMPORT_MAX_JOBS` 和 `MUSIC_IMPORT_MAX_STAGING_BYTES` 可从 `.env` 调整。RabbitMQ 管理界面可观察 ready/unacked 消息与死信队列；另用 `docker stats` 观察 app/rabbitmq 的 CPU、内存。运行 `docker compose logs app | Select-String 'queueWaitMs|processingMs'` 可查看首次领取前的排队毫秒数和每次尝试的处理毫秒数；重试时 `queueWaitMs=-1`。队列缓冲短时高峰，但 HTTP 接收与暂存上传文件的成本仍会发生。

## Redis 公开详情缓存

目前只缓存 `GET /api/v1/articles/{slug}` 和 `GET /api/v1/chatter/{slug}` 返回的公开 DTO；列表、搜索和 404 不缓存。命中时直接返回 Redis 中的 JSON，未命中时按 Cache-Aside 回源 PostgreSQL。Redis 不可用或缓存值无法解析时，公开内容接口回退到 PostgreSQL；认证 session 不会回退。

默认 TTL 为 5 分钟，再随机增加 0–30 秒；回源锁租期为 10 秒，未拿到锁的请求最多等 2 秒并每 50 毫秒重查缓存，超时后直接回源。锁用 `SET NX PX` 获取，并以唯一 token 原子释放。数据库查询异常地超过锁租期时，仍可能发生重复回源；锁用于削减重复读取，不代替数据库事务。

编辑器在 `@Transactional` 写事务内发布 `PublicContentChangedEvent`，由 `PublicContentCacheInvalidator` 在事务提交后删除受影响的详情 key，包括改名时的旧 Slug 与新 Slug。提交后 Redis 不可用时，失效会记录错误日志，旧值最多受 TTL 限制；缓存不是跨 PostgreSQL 与 Redis 的强一致事务。并发旧读在删除后回填旧值的竞态也可能造成短暂陈旧，当前公开内容缓存按有界陈旧策略处理。

默认连接为 `localhost:6379`，可通过 `.env` 中的 `REDIS_HOST`、`REDIS_PORT`、`REDIS_PASSWORD`、`REDIS_SSL_ENABLED`、`REDIS_TIMEOUT` 调整；Compose 主机端口通过 `REDIS_HOST_PORT` 设置。

静态文件目录默认为仓库中的 `public/articles/`、`public/chatter/` 和 `music/`。可通过 `ARTICLE_CONTENT_DIR`、`CHATTER_CONTENT_DIR`、`MUSIC_CONTENT_DIR` 调整。编辑器和音乐管理员上传会写入对应目录；其他接口仅读取它们。

## PostgreSQL 与演示数据

Compose 将 PostgreSQL 映射到本机 5433 端口，数据库名为 `air_spring_dev`，数据保存在 `backend-spring_postgres-data` Docker 卷中；Redis 映射到本机 6379，没有持久化卷。RabbitMQ 的消息与未处理音频暂存文件分别使用独立具名卷。首次启动会由 Flyway 执行 `src/main/resources/db/migration/` 中的结构迁移；音频任务表和 outbox 使用 `V1001`，排在本地夹具及 `V1000` Java 迁移之后。`local` 和 `test` profile 会加入完全虚构的参照记录；占位密码不能用于登录。

恢复空白本地演示库会删除此 Compose 项目的数据卷：

```powershell
docker compose --env-file .env down --volumes
docker compose --env-file .env up --build -d --wait
```

上述命令也会删除 RabbitMQ 消息和未处理的音频暂存文件，只能用于可丢弃的本地学习数据；有待处理导入任务时不要执行。SQLite 数据迁移目前尚未执行，也没有接入 Java 服务。

## 运行测试

`BaselineIntegrationTest` 连接本机 Compose PostgreSQL/Redis，并验证健康接口、Flyway 和虚构样例。宿主机运行 Maven 时，PowerShell 不会自动读取 `.env`；可在当前窗口临时导入配置后执行：

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
    $name = $matches[1]
    $value = $matches[2]
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}
$env:SPRING_DATASOURCE_URL = 'jdbc:postgresql://localhost:5433/air_spring_dev'
$env:REDIS_HOST = 'localhost'
$env:REDIS_PORT = '6379'
.\mvnw.cmd test
```

这只把配置放入当前 PowerShell 进程环境，不会把凭据写入仓库或打印到终端。

## 学习入口

- `AirChordSpringApplication`：Spring Boot 启动入口与组件扫描。
- `HealthController`、`PublicContentController`：HTTP 路由如何连接到 Java 方法和 DTO。
- `ContentReadService`：公开状态过滤、DTO 转换与媒体 URL 检查。
- `ContentReadRepository`：通过 `JdbcClient` 写 SQL、参数绑定和分页查询；仅返回持久层 `ContentItemRecord`，由服务层转换 API DTO。
- `PublicContentCache`：详情 Cache-Aside、TTL 抖动、同 key 回源锁、Redis 故障时回源。
- `PublicContentChangedEvent`、`PublicContentCacheInvalidator`：内容写事务提交后触发详情缓存删除。
- `CommentService`、`GuestbookService`：目标校验、一级回复、软删除与可见状态。
- `AdminUserService`：角色/启用状态校验、最后管理员保护与提交后 Redis session 撤销。
- `InMemoryRateLimiter`：单进程滑动窗口、IP/账号桶与 429 响应头。
- `ContentEditorController`、`ContentEditorService`：multipart 表单、状态与 Slug 规则、PostgreSQL/JDBC 写入和原子文件备份。
- `LocalMusicService`：playlist.json、音乐标签读取、封面响应和本地音频上传管理。
- `MusicImportService`、`MusicImportRepository`：私有文件暂存、任务容量检查、状态和 PostgreSQL outbox。
- `MusicImportOutboxPublisher`、`MusicImportConsumer`：RabbitMQ 发布确认、串行消费、重复投递和失败恢复。
- `ArticleMetricController`、`ArticleMetricService`、`ArticleMetricRepository`：文章浏览与点赞 API、事实唯一键和异步统计 SQL。
- `ArticleMetricOutboxPublisher`、`ArticleMetricConsumer`、`ArticleStatsCache`：指标事件发布、幂等消费和 Redis 计数缓存。
- `AuthSecurityConfiguration`、`AuthSessionService`：安全过滤器、CSRF、Cookie session ID 轮换与 Redis session。
- `AuthController`、`AuthService`、`AuthUserRepository`：认证 HTTP 接口、账号规则和 JDBC SQL。
- `AuthSessionValidationFilter`：每次认证请求核对账号状态、角色和固定时限。
- `PublicMediaConfiguration`：把文章、说说和音乐目录映射为静态 URL。
- `ApiExceptionHandler`：把控制器异常转换成前端可读的稳定 JSON。
- `db/migration/`：Flyway 版本迁移；迁移应用后只新增版本，不修改已应用脚本。
- `V3__add_content_search_index.sql`：生成 `tsvector` 搜索列并创建 GIN 索引；今后写接口更新内容时由 PostgreSQL 自动更新搜索列。
- `V1002__index_literal_content_search.sql`：安装 `pg_trgm`，回填并维护字面搜索列，为公开搜索建立部分 GIN 索引。
- `src/test/resources/contracts/`：根据 Python 测试和前端 DTO 整理的 JSON 参照。

本地运行 Java 与 Python 时，两者各自使用不同端口和数据库；前端及 Python 配置没有改动。

