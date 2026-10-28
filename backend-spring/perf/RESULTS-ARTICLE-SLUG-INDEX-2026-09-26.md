# 公开文章 slug 查询索引验证（2026-09-26）

## 改动

新增 Flyway `V1004__index_public_content_normalized_slug.sql`，为已发布、未删除的内容建立 `(content_type, lower(trim(slug)))` 表达式索引。文章指标的 `publishedArticleId` 和公开详情的 `findPublished` 保持原 SQL，不改变不区分大小写、忽略两端空格的匹配规则。隔离库共有 4004 条内容，新索引约 208 kB。隔离库的 slug 均已规范化，但该样本不足以证明其他数据库中的旧内容也如此，因此没有直接改为 `slug = :slug`。

## 执行计划

隔离库未加索引时，文章指标原查询对 `content_items` 顺序扫描，缓存变热后数据库执行约 2.433 ms。先在可回滚事务中建索引验证，原 SQL 改走 Index Scan，执行约 0.047 ms；事务随后回滚。再由 Flyway 正式应用 V1004，`flyway_schema_history` 记录成功，原 SQL 仍走新索引，执行约 0.084 ms。公开详情取正文的同类查询也走新索引，执行约 0.045 ms。带两端空格和大写的 `  PERF-ARTICLE-1  ` 仍解析为 `perf-article-1`。

这些 `EXPLAIN (ANALYZE, BUFFERS)` 数字是无并发时的 PostgreSQL 内部执行时间，不包括获取连接、网络和 Spring 过滤器。

## 同场景请求对照

在保留的 `air-perf` 隔离库中，同一 Node 客户端以 100 并发工作者分别发送 10000 次重复点赞。业务结果均为 `changed=false`，没有新增点赞或 outbox。迁移前用旧镜像，迁移后重建仅 `air-perf` 应用容器。

| 指标 | 迁移前 | 迁移后 |
| --- | ---: | ---: |
| 吞吐 | 975.4 RPS | 1442.7 RPS |
| HTTP p50 / p95 | 83.6 / 185.5 ms | 61.3 / 115.2 ms |
| 文章查询调用均值 | 17.34 ms | 0.89 ms |
| Hikari 待连接线程采样最大值 | 80 | 0 |

这是一轮改前、一轮改后的本机结果，应用重启、缓存与其他本机资源状态可能影响数字；它也只覆盖重复点赞路径，不能直接推算有效浏览和有效点赞的增益。原始输出在 `target/slug-index-before.jsonl` 和 `target/slug-index-after.jsonl`。

索引会增加内容写入时的维护成本与磁盘占用。当前迁移使用普通 `CREATE INDEX`；如果未来在大量线上内容上应用，应评估索引构建期间的写入锁影响并安排迁移窗口。
