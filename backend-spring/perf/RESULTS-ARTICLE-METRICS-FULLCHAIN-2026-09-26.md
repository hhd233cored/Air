# 文章浏览/点赞完整链路复测

日期：2026-09-26。使用新建的隔离项目 `air-perf-drain-fullchain-20260926`，重新测试当前默认处理参数，并统计 HTTP、数据库、发布器、RabbitMQ、消费者、Redis 失效和计数收敛。范围是文章指标后端链路；不包含浏览器渲染、文章正文/列表查询吞吐或故障恢复实验。

## 核心结果

四轮共 **40,000 次有效写入：30,000 浏览、10,000 点赞**，全部 Confirm、批量标记 published、消费 apply 成功，逐篇事实和统计一致，最终队列排空。

| 场景（各两轮） | HTTP 合并吞吐 | 全批消费完成吞吐 | 单轮 HTTP p95 范围 | HTTP 完成后的消费尾部 |
|---|---:|---:|---:|---:|
| 登录浏览/点赞混合 | 958.2 RPS | 890.6 事件/s | 149.7–166.0 ms | 0.715–0.869 s |
| 匿名浏览 | 907.0 RPS | 747.8 事件/s | 202.9–222.1 ms | 2.210–2.483 s |

HTTP 返回后还有异步工作。匿名场景待发布峰值约 **2,700–2,800** 条，消费 apply 事务起点相对入口事务起点的滞后均值约 **2.1–2.3 秒**。这次默认发布配置下，异步尾部比上一轮池 20/连续发布实验更明显；两次实验同时改变了池、发布配置和数据库状态，不能单独计算某个参数的因果收益。

**本轮已测主要成本：共享池取连接等待、HTTP 写事务 commit，以及发布供给与其轮询间隔。** 账号/文章 execute 和 Redis 批量 DEL 较短。完整 HTTP 仍有未归属的客户端/入口/响应余量，尚未形成覆盖全部延迟的单一瓶颈结论。

## 配置与工作负载

- 应用镜像：`air-perf-pool-http:local`，ID `sha256:20148162e6276d13220ff2735944d1c3ea8bfa76d022972cc716a44124795a20`。沿用上轮已完成 56 项 Java 回归的业务/观测实现，本轮未修改业务源码。
- 当前默认处理参数：Hikari maximum/minimum-idle **10/10**；发布器每轮最多 **1 批**、每批最多 **200**，run-budget 250 ms；消费者单并发、每批最多 **100**、聚批最多 **100 ms**。每轮预检从应用核对真实池参数。
- PostgreSQL 18.6，fsync/synchronous_commit 开启，fdatasync；PG IO/WAL timing 与 pg_stat_statements 开启。Redis 8.4、RabbitMQ 4.3.6。
- 测处理能力时关闭限流，保留正常鉴权/CSRF。此配置的吞吐不是默认限流下的用户可达吞吐。
- Host 客户端：Windows、本机回环访问，Node **v24.15.0 / Undici 7.24.4**。开发栈保持运行，客户端与服务共享主机资源。
- 每轮 **10,000 次请求、并发 100、100 篇文章**，每篇 100 请求；混合每个用户先浏览再点赞，5,000 账号，登录准备并发 4。匿名只有探针账号登录，突发浏览保持匿名。
- 顺序混合/匿名/匿名/混合，各场景两次重复；每轮重启 app，文章范围 1–100、101–200、201–300、301–400。第一轮新卷 seed，后续保留数据并用新范围。准备、登录、统计核对时间不计入 HTTP burst。
- 2,000 篇文章夹具，每篇正文 600 字符；另有应用引导文章 2 篇，全库文章正文合计 **1,760,138 字节**。本轮指标写请求只查文章存在性，未读取整篇正文。
- Server-Timing、客户端传输计时全量；详细 JDBC 抽样 10%，实际 **4,057 / 40,000**。发布器和消费者为完整批次日志。

这是每轮约 10–11 秒的闭环突发测试，并非长期稳态容量验证。混合登录/准备耗时 R1 **77.8 秒**、R4 **82.7 秒**，匿名准备均 **1.1 秒**；预热程度不同，不能把混合/匿名吞吐差直接当作鉴权成本。统计 GET 用于压测前快照和结束后的收敛核对，本轮未测并发统计/详情读取压力，也未采集 GET 延迟分位数。

## 统计口径

1. **HTTP 吞吐**：有效请求数 / 客户端单调时钟 burst 时间。p50/p95/p99 是客户端调用至正文读完的单轮请求分位数。
2. **全批消费完成吞吐**：有效事件数 /（最后一个消费者完成日志时间 − burst 起点）。消费者完成日志在统计事务提交、Redis 失效和所有 basicAck 调用返回之后产生。它是本批 workload 完成吞吐，不是逐事件端到端延迟，也不是 RabbitMQ 对 ACK 的独立确认时间；最终队列检查补充验证排空。
3. **异步滞后分布**：逐事件从 outbox `created_at` 到 `published_at` / processed `processed_at` 的差值，全部 40,000 个事件匹配。三个字段使用 `now()`，代表各事务起点。因此 applyStartLag 不包含消费事务执行/提交、缓存失效及 ACK，publishLag 也不等于 Confirm 完成延迟。依据 [PostgreSQL 时间函数文档](https://www.postgresql.org/docs/18/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT)。
4. 发布与消费可并行，消费者可能早于发布器批量 published 标记开始事务。不能把 `processed_at - published_at` 负数当错误，也不能据此计算 broker 排队延迟；本轮 **16,436** 个事件有这种顺序。created→processed 没有负值。
5. JDBC hold 包含 SQL/读取/commit，不能再相加；消费者 applyCall 含 applyAcquire/applyBody/commitApprox；publisher send、confirm callback 与最终 confirmWait 存在并行，不将嵌套阶段重复相加。
6. 合并吞吐为总请求数 / 总时间，详细 JDBC 均值按抽中样本加权。报告给出单轮分位数，不把两个 p95 的平均称为合并 p95。按秒 CSV 使用请求/批次**完成时间**归桶，探针缺失留空，不当作零。

## HTTP 与整批完成时间

| 轮次 | 场景 | HTTP RPS | p50 / p95 / p99 ms | HTTP 完成 s | 最后发布 s | 最后消费完成 s | 全批事件/s |
|---|---|---:|---|---:|---:|---:|---:|
| R1 | 混合 | 981.3 | 96.1 / 149.7 / 218.6 | 10.190 | 10.798 | 10.905 | 917.0 |
| R2 | 匿名 | 901.3 | 99.7 / 222.1 / 312.3 | 11.096 | 13.200 | 13.306 | 751.5 |
| R3 | 匿名 | 912.9 | 101.6 / 202.9 / 272.3 | 10.955 | 13.306 | 13.438 | 744.2 |
| R4 | 混合 | 936.1 | 102.8 / 166.0 / 220.7 | 10.683 | 11.437 | 11.552 | 865.7 |

表中完成时刻按同一 burst 起点的墙钟对齐，客户端单调时钟 burst 有毫秒级差异。混合浏览 HTTP p95 为 R1 **151.8 ms**、R4 **168.7 ms**；点赞分别 **147.2/162.8 ms**。两种操作各占同一混合窗口的一半，操作 RPS 不能解释为其独立容量。

管理接口 `pipeline-drained` 观测为 18.086/17.927/17.666/14.580 秒，受统计刷新和轮询影响，不能替代上述实际消费日志完成时刻。混合逐篇计数首次检查通过；匿名两轮均第三次通过（检查之间等待 1 秒），这不是精确计数可见延迟分位数。

## 数据库与 HTTP 等待

单位 ms；取连接为每请求全量累计均值，其余 JDBC 为抽样均值。

| 场景合并 | 取连接 | hold | commit | commit / hold | 账号 execute | 文章 execute | 响应头等待未归属余量 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 混合 | 31.990 | 9.895 | 6.591 | 66.6% | 0.461 | 0.476 | 58.170 |
| 匿名 | 56.940 | 10.723 | 7.639 | 71.2% | 0 | 0.600 | 37.322 |

池 10 采到 active=10，pending 峰值 79–82；写入、发布 claim/mark 和消费者查询/事务共享这个池。取连接排队明显，commit 仍占连接持有的大部分。

未归属余量沿用 `clientAwaitHeaders - tomcatPreFilter - preController - controller`；Tomcat 从请求解析起点计时，不包含更早 accept/poller/executor 等等待。余量还包含网络/转发、响应准备和客户端调度，不能视为纯网络时间。已有边界说明见 [连接池与 HTTP 实验](RESULTS-ARTICLE-METRICS-POOL-HTTP-2026-09-26.md)。

四轮 WAL 单次 fsync 均值 **3.546/4.712/4.586/4.236 ms**，write **0.071/0.114/0.068/0.106 ms**；累计 WAL write+fsync 时间中同步占 **97.6%–98.5%**。均采到 `IO:WalSync` / `LWLock:WALWrite`，R2 另采到 DataFileRead/WalWrite；无 deadlock、checkpoint 增量或 pg_stat_statements dealloc。这些 PG 共享窗口计数不能直接换算每请求物理磁盘开销。

## 发布器、队列与消费者

### 发布器

共 **210 批**发布 40,000 事件，每批平均 190.5 条；Confirm/marked 全部成功，每批一次 mark UPDATE。

| 发布阶段 | 累计耗时 ms | 每批平均 ms |
|---|---:|---:|
| claimOutbox | 6873.696 | 32.732 |
| send | 13643.346 | 64.968 |
| 最后确认等待 confirmWait | 818.849 | 3.899 |
| 批量 markPublished | 5877.529 | 27.988 |

单轮事件 Confirm 平均回调延迟 **4.285/4.204/4.730/3.772 ms**。发送返回后等待只是确认路径的一部分；不能把 confirmWait 单独视为完整 RabbitMQ Confirm 延迟。claim/mark 包含数据库连接等待与事务成本，send 包含客户端 RabbitTemplate 路径，均非纯 SQL/broker CPU 时间。

轮间平均空档为 **102.0–103.2 ms**，每轮仅一批。既有发送/claim/mark 成本，也有轮询空档；默认发布模式的供给值得继续对照，不能仅凭本表决定提高并发。

### 同一时间轴上的峰值

| 轮次 | 池 pending | outbox 待发布 | Rabbit ready | Rabbit unacked |
|---|---:|---:|---:|---:|
| R1 | 81 | 800 | 0 | 57 |
| R2 | 82 | 2706 | 179 | 100 |
| R3 | 80 | 2832 | 0 | 100 |
| R4 | 79 | 1087 | 158 | 100 |

这是约 500 ms 间隔探针采到的峰值，可能漏采；ready=0 不代表运行中一直没有消息。匿名场景积压主要出现在 outbox，最后消费比最后发布晚 **106–132 ms**，提示发布供给及共享数据库资源是异步链路的重要限制，尚不能完全排除消费端反压。

### 消费者

共 **455 批**，平均 87.9 条/批；455 次成功事务、455 条统计 UPSERT、455 次 Redis 批量 DEL、40,000 次逐条 ACK 调用。所有 apply 成功，duplicate/reject/requeue、缓存删除失败均 0。

| 消费阶段 | 全四轮每批平均 ms | 边界 |
|---|---:|---|
| cycle | 56.397 | 监听器内部，排除此前聚批/队列等待 |
| event 查询 | 17.494 | 含其中取连接 15.559 |
| applyCall | 32.219 | 含取连接、事务体与提交 |
| apply 取连接 | 14.694 | 已包含在 applyCall |
| processed 防重 SQL | 3.851 | 已包含在事务体 |
| stats SQL | 5.977 | 已包含在事务体 |
| commitApprox | 6.945 | beforeCommit→afterCommit，非直接 JDBC commit |
| Redis DEL | 1.437 | 每批一次、多键删除 |
| ACK | 3.738 | 本批逐条 basicAck 调用耗时 |

event/apply 两次取连接累计占消费者 cycle 约 **53.6%**。Redis DEL 约占 **2.5%**，本轮不是显著成本。以上为批次均值，不是每事件延迟；HTTP、发布、消费并行运行，累计耗时不能相加当作整批壁钟时间。

## 逐事件异步滞后

SQL 查询完整覆盖各轮 10,000 事件，单位 ms。下表 `applyStartLag` 为**入口事务起点到消费 apply 事务起点**，边界见前文。

| 轮次 | publishLag 均值 | applyStartLag 均值 | p50 | p95 | p99 | 最大 |
|---|---:|---:|---:|---:|---:|---:|
| R1 混合 | 414.720 | 432.703 | 393.219 | 766.780 | 821.993 | 857.287 |
| R2 匿名 | 2093.700 | 2144.378 | 2314.658 | 3111.487 | 3190.024 | 3242.824 |
| R3 匿名 | 2235.687 | 2277.475 | 2621.789 | 3159.580 | 3231.778 | 3278.845 |
| R4 混合 | 570.611 | 620.054 | 570.913 | 1167.643 | 1258.447 | 1312.424 |

全部 40,000 事件直接 SQL 合并分布：applyStartLag 平均 **1368.653 ms**，p95 **3038.045 ms**、p99 **3188.987 ms**。这个合并值混合不同场景，单场景判断以上表为准；它不代表 HTTP 请求发起到缓存失效/ACK 的逐事件 p95。全量确切端到端分位数还需要跨入口、发布、消费的事件关联与完成时间戳。

## 正确性与收尾

- 每轮请求全为 changed：混合 5,000 HTTP 202 + 5,000 HTTP 200；匿名 10,000 HTTP 202，无 HTTP/网络失败。
- 全量传输/Tomcat/基础计时覆盖 40,000，missing=0；JDBC 抽样 4,057，借出=归还，SQL/commit/close 失败和 rollback 均 0。
- 每轮事实、统计、outbox、processed 完整核对；全库浏览事实/统计 **30,000/30,000**，点赞 **10,000/10,000**，outbox/processed **40,000/40,000**；未发布、错误文章、残留测试 schema 均 0。
- outbox attempt_count 全为 0；各轮四个 RabbitMQ 队列（含死信）最终 ready/unacked 均为 0。
- 本轮新增只读汇总脚本和异步滞后 SQL；汇总在历史实际数据和本轮四组数据验证通过，逐秒累计数与 40,000 写入闭合。没有重新执行业务单元测试，沿用同一已测镜像，完整链路复测直接验证业务。
- 本次实验项目容器已全部停止，卷和结果保留；原开发栈四个容器继续运行，未变更其参数。

## 数据文件与复现

可下载/查看的统计文件（路径相对 backend-spring）：

- [逐轮摘要 CSV](../target/fullchain-headline-2026-09-26.csv)
- [按秒链路 CSV](../target/fullchain-timeline-2026-09-26.csv)：HTTP 完成/累计、published/applied 完成/累计、取连接与抽样 hold/commit、池/outbox/队列/PG 等待探针；空字段代表缺失采样。
- [完整报告数据 JSON](../target/fullchain-report-data-2026-09-26.json)
- `target/fullchain-summary-2026-09-26.jsonl`：原始阶段汇总、同秒探针与合并场景统计。
- 各 Label 对应客户端、配置、发布消费、队列、业务核对、逐事件滞后日志；`target/fullchain-final-validation-2026-09-26.json` 为全库核对。

Labels 为 `fullchain-r1-mixed-2026-09-26`、`fullchain-r2-anonymous-2026-09-26`、`fullchain-r3-anonymous-2026-09-26`、`fullchain-r4-mixed-2026-09-26`。

用新项目、新 Label 运行；复用卷时省略 Seed 并选未写过的文章范围：

```powershell
./perf/run-metric-experiment.ps1 -Project air-perf-drain-fullchain-example `
  -Label fullchain-example -AppPort 18311 -RabbitPort 18312 `
  -Scenario mixed -Image air-perf-pool-http:local `
  -PoolSize 10 -PublisherBatches 1 -ConsumerBatchSize 100 `
  -ArticleCount 100 -ArticleOffset 1 -Requests 10000 `
  -JdbcTiming -JdbcSampleRate 0.1 -PostgresCounters -HttpTransportTiming -Seed -StopStack
node perf/summarize-fullchain.mjs target/fullchain-example
```

逐事件查询在该实验数据库运行 `perf/fullchain-event-lag.sql`，传入 psql 变量 `article_start/article_end`。只读 SQL 可在完整压测结束后执行；不要将事务起点差值命名为真实提交/ACK 延迟。

## 下一步

保留本轮作为当前默认处理参数的完整链路基线。优先用独立客户端做更长的稳定负载；随后将池 10/20 与发布每轮 1/4 批组成独立对照，重点同时看 HTTP、全批完成吞吐、逐事件滞后和异步积压。已有数据说明扩大池与连续发布值得验证，但还需要相同数据库状态/负载下的组合对照来决定默认配置。
