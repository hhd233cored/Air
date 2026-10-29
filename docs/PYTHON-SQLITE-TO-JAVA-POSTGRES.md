# Python SQLite 到 Java PostgreSQL：本机数据迁移指南

本文说明如何把 `backend-python/data/auth.sqlite3` 中的业务数据，一次性追加到 `backend-spring` 使用的 PostgreSQL 开发库。迁移程序是 [`migrate_python_sqlite.py`](../backend-spring/scripts/migrate_python_sqlite.py)；[2026-10-28 的执行记录](../backend-spring/perf/RESULTS-PYTHON-SQLITE-MIGRATION-2026-10-28.md)保存了这次本机迁移的实际数量和校验结果。执行记录是历史结果，不能代替下次运行时的预检输出。

## 迁移范围

| SQLite 来源 | PostgreSQL 目标 | 处理方式 |
| --- | --- | --- |
| `users` | `users` | 追加，保留 ID、角色、启用状态、Argon2id 密码哈希、头像及时间戳 |
| `content_items` | `content_items` | 追加文章和说说，保留 ID、Slug、正文、标签、封面、状态及时间戳；由现有 Python 预览逻辑生成 `preview` |
| `comments` | `comments` | 追加，保留评论 ID、正文、状态和父子关系 |
| `guestbook_messages` | `guestbook_messages` | 追加，保留 ID、正文、状态及时间戳 |
| `auth_settings` | `auth_settings` | 同名键按 SQLite 值更新 |

目标库原有的账号、内容、评论和留言会保留。账号 ID、用户名、内容 ID、内容类型与 Slug、评论 ID、留言 ID 如与目标库冲突，预检就会终止。脚本不会自动合并冲突，也不会跳过已导入的行，所以**不要对同一目标库重复执行 `--apply`**。

Python 的登录 session 不迁移到 Java 的 Redis session，用户需重新登录。SQLite FTS 索引不复制，PostgreSQL 自行维护搜索列和索引。图片、音频等媒体文件不在该 SQLite 文件中；迁移后仍需确保 Java 服务可访问项目的共享媒体目录。该源库没有文章点赞或浏览指标表，因此不会生成历史指标。

## 执行前

此流程针对**本机开发库**。需要 Python 3、运行中的 Docker Desktop，以及已经通过 Java 应用初始化数据库结构的 PostgreSQL 容器。以下命令在仓库根目录的 PowerShell 执行，假定 `backend-python/.venv` 已存在；若 Python 环境位置不同，把 `$python` 改为可用的 Python 3 路径。

先确认源库和环境文件存在。不要把 `.env`、SQLite 源库或备份提交到 Git。

```powershell
# 先在 PowerShell 中切换到本仓库根目录
$python = Join-Path (Get-Location).Path 'backend-python\.venv\Scripts\python.exe'
Test-Path .\backend-python\data\auth.sqlite3
Test-Path .\backend-spring\.env
Test-Path $python
```

上述三项应均为 `True`。先停止 Java 应用，保留 PostgreSQL 运行；在检查和导入期间避免其他进程向目标库写入。脚本也会检查 Compose 的 Java 容器是否仍在运行。

```powershell
Set-Location .\backend-spring
docker compose --env-file .env stop app
docker compose --env-file .env up -d --wait postgres
```

## 预检、备份与导入

先运行不带 `--apply` 的预检。它会只读检查 SQLite 的完整性和外键、字段格式以及目标库的键冲突，并输出 `PREFLIGHT_OK`、源库和目标库原有记录数。若预检失败，先处理报错，不要直接导入。

```powershell
& $python .\scripts\migrate_python_sqlite.py
```

确认目标确实是允许追加数据的本机开发库后执行：

```powershell
& $python .\scripts\migrate_python_sqlite.py --apply
```

脚本会先用 SQLite 在线备份生成一致的源库快照，再用 `pg_dump -Fc` 备份**导入前的整个目标库**，随后在一个 PostgreSQL 事务中导入并推进相关自增序列。导入后会检查表行数、密码哈希、Markdown 正文、评论与留言文本及头像字节。成功时输出 `status: VERIFIED`，并在以下目录写入快照、备份和 `report.json`：

```text
backend-spring/target/python-sqlite-migration-<UTC时间>/
  source.sqlite3
  target-before.dump
  report.json
```

`backend-spring/target/` 被 Git 忽略。这些文件可能含账号哈希、头像和业务正文，应妥善保存；本文档和执行记录则位于未忽略的路径。脚本在预检失败时不会创建备份；如果 SQL 事务提交前出错，PostgreSQL 会回滚导入。若提交后校验失败，**不要假定导入已回滚**，应先检查目标状态和备份，再决定恢复方式。

## 启动与核验

```powershell
docker compose --env-file .env up -d --wait app redis rabbitmq
Invoke-RestMethod http://localhost:8081/api/v1/health
Invoke-RestMethod 'http://localhost:8081/api/v1/articles?page=0&size=10'
Invoke-RestMethod 'http://localhost:8081/api/v1/chatter?page=0&size=10'
```

健康接口应返回 `UP`。再检查迁入的文章详情、评论、留言以及一个迁入账号的登录，并确认媒体链接可访问。行数应以本次 `report.json` 中的 `source`、`target_before` 和 `target_after` 为准：除同名键更新的 `auth_settings` 外，导入后数量应等于导入前数量加源库数量。公开接口可能过滤草稿、隐藏留言和软删除内容，因此其返回量不一定等于表总行数。

## 出错与恢复

- **预检报键冲突**：通常表示目标库已有同一批数据或同名业务记录。停止本次迁移，核对目标库和上次的 `report.json`；不要为绕过冲突而直接删除行。
- **导入 SQL 报错**：确认脚本的退出状态，并检查目标行数。事务提交前的错误会回滚，但备份仍应保留。
- **提交后校验失败或需要回到导入前**：先停止 Java 应用及其他写入者，保存当前目标库，确认允许丢弃迁移后产生的全部新数据。`target-before.dump` 是整库备份，恢复它会覆盖导入以来的更改。建议先把备份恢复到**另一个临时数据库**，比较数据与结构；确认后再按 PostgreSQL 的 `pg_restore` 流程替换目标库。不要运行 `docker compose down -v`，这会删除数据库卷。

本指南仅覆盖此仓库当前的表结构和本机 SQLite 文件。若源库或 Java 数据库 schema 后续变化，应先更新并验证迁移程序，再做新的导入。
