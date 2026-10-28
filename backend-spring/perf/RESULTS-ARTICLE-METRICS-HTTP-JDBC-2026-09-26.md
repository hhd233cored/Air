# HTTP 连接持有、JDBC 执行与提交拆测（2026-09-26）

## 实现与口径

接续 [消费者批量 SQL/缓存记录](RESULTS-ARTICLE-METRICS-CONSUMER-BULK-2026-09-26.md)，本次增加 HTTP 计时，没有改账号验证、文章定位、事实/outbox 事务或异步处理策略。

详细计时需要同时设置 `AIRCHORD_PERF_TIMING_ENABLED=true`、`AIRCHORD_PERF_JDBC_ENABLED=true`，请求携带 `X-Perf-Timing: 1`。后者默认 false；压测脚本用 `-JdbcTiming` 开启。未计时请求直接获得原 Hikari 连接，详细开关关闭时数据源也保持原实例。

计时数据源在 Hikari 借出之后包装当前请求的 JDBC 接口，按借出至 `close()` 成功返回记录租用时间；原 Hikari 回调继续记录借连接等待。SQL 分类只按应用语句的表名识别，不记录 SQL 文本、绑定值、密码或用户数据。连接按第一条执行 SQL 分为账号查询、文章定位、写事务、其他；事实与 outbox 同一事务只算一份写连接持有时间。

| 指标 | 范围 |
| --- | --- |
| dbAcquirePre / dbAcquireController | Hikari 借连接耗时，包含排队和池内检查，按 controller 前/内区分 |
| dbHold / dbHoldAccount / dbHoldArticle / dbHoldWrite / dbHoldOther | 已借到连接的租用时间；分项之和为总持有时间 |
| jdbcPrepare | createStatement / prepareStatement / prepareCall 的 JDBC 调用 |
| jdbcExecute | execute* 调用累计；分为 jdbcAccount / jdbcArticle / jdbcFact / jdbcOutbox / jdbcOther |
| jdbcRead | ResultSet 游标 next 与 getter 调用累计 |
| jdbcCommit | Connection.commit 的直接调用时间；不含 Spring 事务回调与归还前的重置 |
| commitApprox | 既有 Spring beforeCommit 到 afterCommit 近似段，保留用于对照 |
| jdbcRollback / dbClose | 直接 rollback 与归还连接 close 调用 |
| dbHoldOtherWork | 持有总量减去上述 prepare/execute/read/commit/rollback/close；包括绑定、框架映射/事务设置、调度与计时代码等剩余成本 |

`jdbcExecute` 已排除取连接等待，但包含驱动、网络、数据库执行与驱动缓冲结果传输，不是纯 PostgreSQL 服务端 CPU 时间。直接 commit 包含驱动、网络、数据库 COMMIT/WAL 持久化等待；还需要数据库侧证据才能进一步拆分。自动提交 SELECT 的隐式事务结束属于 execute 调用，不会增加显式 commitCalls。

持有时间与 SQL/提交是包含关系，不能相加。多条连接的持有累计在有重叠租用时可能大于请求墙钟时间，本次通过借出/归还和各类租用次数核对。`X-Perf-Db-Counts` 返回 borrowed/closed、各类租用、SQL/提交/回滚及失败计数。

客户端增加 `jdbc-completed-second`，按请求完成时刻分桶，保留各指标累计、均值和 p95；[summarize-http-jdbc.mjs](summarize-http-jdbc.mjs) 将它和借连接、outbox、RabbitMQ、PostgreSQL 等待探针按同一 epoch 时间轴对齐。桶不是 SQL 执行的精确发生区间，跨秒请求全部归于完成桶。探针保留原采样时间，同桶没有探针时显示 null。

## 验证

51 个测试全部通过、无跳过：JDBC 5、PostgreSQL 集成 5、消费者 20、发布器 18、缓存 3。

- 未计时/开关关闭返回原连接；包装后的 JDBC 接口、ResultSet/Statement/Connection 身份、unwrap、绑定参数与原异常类型保留。
- 一次写租用覆盖事实和 outbox，两条执行与一次 commit；SQL/commit 异常、rollback、close 失败后重试、重复 close 的计数验证。
- 真实 PostgreSQL 中模拟账号查询、文章定位与一次浏览写事务，核对三份借出/归还、四条 SQL、一次 commit；outbox 失败时浏览事实回滚、rollback 被记录。
- 既有防重、共享 deliveryTag、消费者整批回滚、缓存故障、Confirm/Return 和租约恢复回归继续通过。

最终日志 `target/http-jdbc-tests-final-2026-09-26.log`。首轮新回滚夹具把约束同时施加到已有成功记录，已改为 NOT VALID 只约束后续写入；最终完整回归通过。测试只使用独立随机 schema，并清理。

## 复测设计

所有轮次同一镜像 `air-perf-http-jdbc:local`，ID `sha256:3dc68ee43b95ce5835fb857ab965d31a47275a59bae1b85ec1120889f2698d67`，沿用相同 Java 21 依赖/JRE/JVM 参数。只用配置开关详细 JDBC 计时，没有对照不同业务实现。

新独立项目 `air-perf-drain-http-off`（18171/18172）与 `air-perf-drain-http-on`（18181/18182），各有相同 2000 篇文章和 5000 用户夹具。一次只运行一组实验栈；每轮启动应用、完成后停止该项目，保留事实和卷，开发栈继续运行。

每轮 10000 次有效写、HTTP 并发 100、100 篇文章 round-robin、池大小 10，消费者单线程/100 条/100 ms，发布器最多 4 批/250 ms，限流关闭，原阶段计时和同时间轴探针均开启。

- R1 关、R2 开、R3 开、R4 关，构成 AB/BA 两轮交替。同种配置分别用文章 1–100、101–200，mixed 浏览/点赞各 5000，每篇 50/50；5000 用户登录准备不计入 RPS。
- R5/R6 开详细计时，匿名浏览各 10000 次，分别用文章 201–300、301–400，每篇浏览 100、点赞 0；没有 5000 用户登录预热。用于观察账号 SQL/租用差异，不把匿名与 mixed 的吞吐差异全部归因于账号查询。

详细组强制核对 10000 个 JDBC 样本覆盖、borrowed=closed、SQL/commit/close 失败为零，并逐篇核对事实/统计/processed/outbox 和工作/死信队列。

## 实测结果

### 详细计时开/关对照

| 轮次 | 场景 / 详细计时 | HTTP RPS | HTTP p95（ms） | 取连接两段均值之和（ms） | commitApprox 均值（ms） |
| --- | --- | ---: | ---: | ---: | ---: |
| R1 | mixed / 关 | 853.2 | 199.1 | 48.54 | 7.65 |
| R2 | mixed / 开 | 867.9 | 216.7 | 70.09 | 6.08 |
| R3 | mixed / 开 | 803.5 | 218.2 | 72.91 | 7.84 |
| R4 | mixed / 关 | 955.1 | 189.6 | 79.85 | 7.21 |
| R5 | 匿名 / 开 | 1010.0 | 189.4 | 54.51 | 6.21 |
| R6 | 匿名 / 开 | 1013.1 | 191.7 | 55.35 | 6.17 |

mixed 两轮总请求 / 总突发秒数计算的 RPS：关 **901.3**、开 **834.4**，详细组低约 **7.4%**，p95 也较高。两个先后对照不足以把差异全部归因于计时代码，但不能宣称详细测量无影响。本次全量包装、反射调用、额外响应头与解析均有测量开销，另有同机 I/O/JIT/调度变化。详细数字用于分段排序与解释当前观测，绝对容量和参数决策需要低采样率复核。

### 每个有效请求的连接与 SQL 次数

| 详细样本 | 混合（两轮共 20000 请求） | 匿名（两轮共 20000 请求） |
| --- | ---: | ---: |
| 每请求 borrowed / closed | 3 / 3 | 2 / 2 |
| 每请求账号 / 文章 / 写连接租用 | 1 / 1 / 1 | 0 / 1 / 1 |
| 每请求 SQL execute / 显式 commit | 4 / 1 | 3 / 1 |
| 累计借出 / 归还 | 60000 / 60000 | 40000 / 40000 |
| SQL / commit / close 失败及 rollback | 全部 0 | 全部 0 |

四轮详细组全部 40000 个请求有完整样本，100000 次租用全部归还，SQL execute 总计 140000 次、commit 40000 次。后台发布/消费和探针请求不属于这些 HTTP 写请求样本。

SQLCalls 是应用 JDBC execute 调用数；驱动内部的 BEGIN、会话设置等命令没有逐条计数，不等于数据库端所有语句总数。

### 连接持有与 JDBC 执行

下表为两轮同场景共 20000 次请求的累计耗时 / 请求数，单位 **ms/请求**。分项已经包含在连接持有中。

| 阶段 | 混合 | 匿名 |
| --- | ---: | ---: |
| 总连接持有 | **11.163** | **9.233** |
| ↳ 账号查询租用 | 1.096 | 0 |
| ↳ 文章定位租用 | 1.025 | 0.916 |
| ↳ 事实/outbox 写事务租用 | **9.041** | **8.317** |
| 所有 SQL execute 累计 | 2.620 | 2.281 |
| ↳ 账号 SQL | **0.533** | 0 |
| ↳ 文章定位 SQL | **0.565** | **0.652** |
| ↳ 事实 SQL | 0.864 | 0.914 |
| ↳ outbox SQL | 0.658 | 0.714 |
| 直接 JDBC commit | **6.934** | **6.169** |
| close 归还调用 | 0.247 | 0.187 |
| 持有中的其他工作 | 1.230 | 0.527 |

混合写租用占总持有 **81.0%**，直接 commit 占总持有 **62.1%**；匿名分别为 **90.1% / 66.8%**。账号查询和文章定位的 execute 均值在本次负载约为 0.5–0.7 ms；它们仍消耗读连接与往返，但当前最大可测持有段是每次有效写的提交。

例如 R2 整体文章 lookup 均值 **27.07 ms**，直接文章 SQL execute 为 **0.584 ms**、文章租用为 **1.180 ms**。lookup 还包含借连接和 JdbcClient/映射等过程，不能把 27 ms 直接称作文章 SQL 执行时间。

| 轮次 | 持有均值（ms/请求） | 写租用占比 | commit 均值 / p95 / p99 / 最大（ms） | 突发期间 HTTP 平均占用连接数 |
| --- | ---: | ---: | ---: | ---: |
| R2 | 10.723 | 77.2% | 6.053 / 8.8 / 11.9 / 122.698 | 9.306 |
| R3 | 11.602 | 84.5% | 7.815 / 11.0 / 14.4 / 117.849 | 9.322 |
| R5 | 9.262 | 90.1% | 6.189 / 9.2 / 13.4 / 140.410 | 9.355 |
| R6 | 9.204 | 90.1% | 6.149 / 9.1 / 12.5 / 105.644 | 9.325 |

平均占用 = 全体 HTTP 已归还连接的持有累计 / 客户端突发墙钟时长，不是某个瞬时快照。租用均在响应完成前关闭，均落在突发窗口内。两轮混合整体平均 **9.314**、匿名 **9.340**，池上限为 **10**；发布/消费与探针还共用同一池。因此少一次账号查询后，匿名写入仍能把共享池推到高占用，并不是只要缓存账号或文章就会消除等待。

R2 的直接 commit 均值 6.053 ms 与原近似段 6.08 ms 接近；R3 为 7.815 / 7.84 ms。近似段在本次大部分成本确实落于直接 commit 调用。长尾仍明显：单次直接 commit 最大超过 100 ms；该时间包含网络/驱动/调度，不能全部归因于磁盘 fsync。

### 同时间轴的等待与积压

| 轮次 | outbox 采样峰值 | ready 采样峰值 | 待连接采样峰值 | 最后发布批次结束 / 最后 ACK（s） |
| --- | ---: | ---: | ---: | ---: |
| R1 | 345 | 175 | 80 | 11.869 / 11.975 |
| R2 | 505 | 0 | 83 | 11.671 / 11.783 |
| R3 | 877 | 137 | 83 | 12.492 / 12.624 |
| R4 | 756 | 31 | 81 | 10.726 / 10.836 |
| R5 | 2461 | 100 | 72 | 11.143 / 11.254 |
| R6 | 2813 | 15 | 77 | 11.366 / 11.479 |

结束时刻均以 HTTP 突发开始为起点。消费者最后 ACK 比最后发布批次结束晚约 106–132 ms；本轮没有再次出现之前持续数秒的消费积压。匿名 HTTP 发得更快时，outbox 增长更明显，发布供给仍会影响异步计数完成时间。ready 峰值来自滞后的管理采样，零峰值不代表从未入队。

R2 完成桶示例：

| 完成秒桶 | 请求数 | 取连接前段 / controller 均值（ms） | 持有均值（ms） | commit 均值（ms） | 同桶最后探针待连接 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 728 | 15.63 / 27.89 | 11.37 | 5.62 | 65 |
| 1 | 887 | 31.68 / 49.55 | 10.36 | 5.52 | 58 |
| 2 | 735 | 40.46 / 62.77 | 13.22 | 7.58 | 81 |

这些桶均采到 `IO:WalSync`、`LWLock:WALWrite`。六轮都出现 WAL 等待，部分轮还采到 WalWrite、DataFileExtend、WALInsert；没有采到 Lock 等待，不能排除瞬时锁。持有/提交升高与队列等待同时出现，是阶段相关性，不能从完成桶确定请求级因果。

### 数据库配置和只读计划检查

结束后的配置快照为 `synchronous_commit=on`、`fsync=on`、`wal_sync_method=fdatasync`，本次未放宽持久化要求。`track_io_timing` 和 `track_wal_io_timing` 为 off，因此不能把未记录的 IO 时长当作零；WAL 的时间占比还需要进一步测量。

压力结束后，在同一独立数据库执行两条只读 EXPLAIN ANALYZE：账号按 ID 使用 `users_pkey` Index Scan、实际返回 1 行，执行 0.114 ms；文章定位使用 `content_items_public_normalized_slug_idx` Index Scan、返回 1 行，执行 0.131 ms。它们只用于检查查询计划，不能替代压力期间的 SQL 时间。文件为 `target/http-{account,article}-explain-2026-09-26.json`。

### 最终核对

六轮每轮均为 10000 次 changed、发送/确认/标记/接收/首次处理 10000，失败与 requeue 为 0；逐篇 wrongArticles 0，工作和死信队列最终 ready/unacked 均为 0。

| 全库核对 | 关闭组数据库 | 详细组数据库 |
| --- | ---: | ---: |
| 浏览事实 / 统计 | 10000 / 10000 | 30000 / 30000 |
| 点赞关系 / 统计 | 10000 / 10000 | 10000 / 10000 |
| outbox / processed | 20000 / 20000 | 40000 / 40000 |
| 未发布 outbox / 测试 schema 残留 | 0 / 0 | 0 / 0 |

核对为 `target/http-final-{off,on}-validation-2026-09-26.json`；配置快照为 `target/http-postgres-settings-2026-09-26.json`。完成后停止本次两个项目容器、保留卷，开发栈未重启，以前实验事实未修改。

## 判断与下一步

当前证据指向 **有效写事务的连接占用，尤其直接 commit，以及共享池排队**。账号与文章定位都有一次租用/查询成本，索引计划和 JDBC execute 数字暂没有暴露它们的 SQL 本身为最大成本。异步完成仍受发布供给影响，消费者批量 SQL/缓存删除已经缓解持续消费积压。

下一步先改为随机抽样部分请求记录详细 JDBC，复核测量扰动和成本排序；再在独立实验栈采集 PostgreSQL 提交/WAL/IO 增量、服务端语句统计与磁盘延迟，进一步区分 commit 中的数据库持久化、网络与调度。连接池扩大或异步资源隔离应作为有证据的对照实验，不能由本次数字直接判断应增加多少连接。账号缓存会影响现有“每次请求核对账号状态/安全版本”的语义，也不应仅凭外层查账号慢就引入。

本次每个详细场景只有两轮，没有独占资源、固定 CPU/IO 配额、随机化或统计置信区间。混合与匿名除账号验证外还有事实类型与预热差异；所有性能数字均限定于当前同机、100 篇分布、发布最多 4 批与池 10 的条件，不外推默认发布器 1 批或生产容量。

## 原始记录与复现

Label：`http-r1-off-2026-09-26`、`http-r2-on-2026-09-26`、`http-r3-on-2026-09-26`、`http-r4-off-2026-09-26`、`http-r5-anonymous-2026-09-26`、`http-r6-anonymous-2026-09-26`。请求/时间轴、配置、发布/消费日志和核对文件均在 ignored 的 `target/`。

跨轮汇总与对齐时间轴为 `target/http-jdbc-summary-2026-09-26.jsonl`，流水线/等待汇总为 `target/http-pipeline-summary-2026-09-26.jsonl`。详细均值从完成桶累计求得；分位数从原客户端逐请求数值汇总，不把各轮 p95 再平均。

新环境按 perf README 准备凭据和夹具目录，再用 `docker build -t air-perf-http-jdbc:local .` 构建当前源码。例：

```powershell
./perf/run-metric-experiment.ps1 -Project air-perf-drain-http-example `
  -Label http-example-on -AppPort 18191 -RabbitPort 18192 `
  -PublisherBatches 4 -ConsumerBatchSize 100 -ArticleCount 100 -ArticleOffset 1 `
  -Image air-perf-http-jdbc:local -JdbcTiming -Seed -StopStack

node perf/summarize-http-jdbc.mjs target/http-example-on
```

下一轮使用新 Label 和未用过的范围，省略 Seed；关闭详细计时则省略 JdbcTiming。脚本不删除数据库或卷，不输出凭据。

后续随机抽样与 WAL/IO 复测已完成，见 [六轮实验记录](RESULTS-ARTICLE-METRICS-WAL-IO-2026-09-26.md)，其中也记录了服务端 COMMIT 统计覆盖和 HTTP 未测部分的限制。
