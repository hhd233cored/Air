# Python SQLite → Java PostgreSQL 本机数据导入（2026-10-28）

## 范围与保护

- 源：`backend-python/data/auth.sqlite3`，通过 SQLite 在线备份生成一致快照；原库未修改。
- 目标：已有的 `backend-spring` PostgreSQL 开发库。导入前仅有本地虚构演示数据；Java 应用停止，数据库单独运行。
- 导入前保存了 PostgreSQL `pg_dump -Fc` 备份；导入在一个事务内完成。备份和详细校验报告保存在被 Git 忽略的 `backend-spring/target/python-sqlite-migration-20261028T125942Z/`。
- 脚本：`backend-spring/scripts/migrate_python_sqlite.py`。默认只做预检；`--apply` 才会备份并写入。存在账号、内容或评论等键冲突时中止，不覆盖目标业务行。

## 数据量

| 表 | SQLite 来源 | PostgreSQL 导入前 | 导入后 |
| --- | ---: | ---: | ---: |
| `users` | 4 | 2 | 6 |
| `content_items` | 4 | 4 | 8 |
| `comments` | 22 | 2 | 24 |
| `guestbook_messages` | 3 | 1 | 4 |
| `auth_settings` | 1 | 1 | 1 |

4 条内容包括 2 篇已发布文章和 2 条已发布说说。保留了用户 ID、账号状态、Argon2id 哈希、头像二进制、内容 ID/Slug、Markdown、标签、封面路径、评论父子关系、时间戳与可见状态。`auth_settings` 的同名键按源值更新。PostgreSQL 自增序列在导入后移到当前最大 ID，避免下次创建账号或评论时撞键。

## 校验

- SQLite `integrity_check`、`foreign_key_check` 及目标键冲突预检通过。
- 导入后记录数符合来源加目标原有记录数；密码哈希、Markdown、评论文本、留言文本和头像二进制的 MD5 与源快照一致。
- Java 应用重新启动后健康接口返回 `UP`；公开 API 返回文章 3 篇、说说 3 条、可见留言 3 条。能读取一篇迁入文章详情及其迁入评论。留言表共有 4 条，其中一条按源状态不公开。

## 未复制

Python `sessions` 与 Java Redis session 不兼容，登录需要重新进行。SQLite 的 FTS 索引不复制，PostgreSQL 的搜索列和索引由自身维护。图片、音频等媒体仍在项目共享目录，不在 SQLite 数据文件中。源库没有文章点赞或浏览事件表，因此没有对应指标可导入。

本次只针对这台机器上的 SQLite 文件和开发数据库；不代表线上 Python 数据已经迁移。
