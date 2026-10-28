# 文章指标：连接池 10/20 与 HTTP 入口、客户端路径对照

日期：2026-09-26。本轮承接 [WAL/IO 实验](RESULTS-ARTICLE-METRICS-WAL-IO-2026-09-26.md)，先比较连接池，再定位该文未拆清的 HTTP 时间。实验记录用于描述测量和后续建议。

## 结论

1. **池 20 明显减少取连接等待，吞吐收益有限。** 两轮合并后，混合场景从 908.3 到 959.8 RPS（+5.7%）；匿名浏览从 973.9 到 1099.6 RPS（+12.9%）。平均每请求累计取连接耗时分别从 40.83 到 1.47 ms、45.54 到 2.44 ms。
2. **数据库连接持有仍主要花在 commit。** 四组抽样 JDBC commit 平均 6.52–7.50 ms，占累计连接持有的 65.6%–69.9%。扩大池后 commit 均值升高，并没有获得与池大小成比例的吞吐。账号、文章 JDBC execute 各约半毫秒，当前证据不支持将查询本身列为首要瓶颈。
3. **整个 HTTP 的主延迟尚不能完全归因于数据库。** 池大小对照中，完整响应头到达之前、扣除已测服务端阶段后的余量平均仍为 30.3–93.6 ms/轮；响应头到达后的 fetch resolve、正文消费很短。客户端事件循环延迟也明显，计时回调可能受调度影响。
4. **容器内访问没有消除余量。** 追加 host/container/container/host 四轮，同版本 Node/Undici；容器内两轮合并 982.0 RPS，host 两轮 1126.0 RPS，余量分别 83.06/68.10 ms。因此“Windows 到 Docker 端口转发是主要原因”未得到本轮支持。该对照同时改变操作系统和客户端资源竞争，不能归因于单一网络因素。

产品连接池配置未调整。本轮只增加默认关闭的 perf 观测和隔离实验参数。下一步优先把客户端移到独立机器，再做并发阶梯和早期入口/响应写出观测。

## 改动与计时边界

- `run-metric-experiment.ps1 -PoolSize 10/20`：隔离 Compose 设置 Hikari maximum/minimum-idle，预检读取应用真实值核对；HTTP、发布器、消费者共享同一个池。
- `-HttpTransportTiming`：Node 内置 Undici diagnostics channel 加单请求 AsyncLocalStorage 关联，记录创建、写请求头、bodySent、完整响应头、fetch resolve、正文读完。缺失或主阶段逆序返回 null，实验覆盖不完整直接失败；不采集 Cookie、正文或 SQL 文本。
- Tomcat perf Valve：将 Coyote 请求解析起点传给最早 filter，增加 `tomcatPreFilter`；探针增加 Tomcat active/size/maximum/queued 线程计数和池实际配置。
- `-ClientLocation container`：同版本 `node:24.15.0-alpine` 在该实验 Docker 网络内访问 `app:8081`，只读挂载 perf 脚本；默认 host 继续访问回环地址。
- HTTP/JDBC 汇总增加客户端阶段、运行时和完成秒桶，与取连接、outbox、RabbitMQ、PG 等待探针对齐。秒桶属于**请求完成时间**，不是 SQL 执行或网络事件的精确发生区间。

客户端六个不重叠主阶段：

| 阶段 | 边界 | 解释 |
|---|---|---|
| clientCallToCreate | 调用 → request:create | fetch 创建与调度 |
| clientCreateToSend | create → client:sendHeaders | 客户端排队、建连和分派等 |
| clientSend | sendHeaders → bodySent | 本客户端已完成请求体发送 |
| clientAwaitHeaders | bodySent → request:headers | 到完整响应头解析完成，含两端等待和调度 |
| clientHeadersDelivery | headers → fetch resolve | 响应对象交付 |
| clientBodyConsume | resolve → text 完成 | 客户端正文消费 |

上述六段相加为 clientTotal。额外的 `clientBodyWire`、`clientAfterWire` 与主阶段重叠，不能再次相加。`request:headers` **不是精确首字节时间**，事件触发时间也可能受到客户端调度影响；边界依据 [Undici 官方 diagnostics 文档](https://github.com/nodejs/undici/blob/main/docs/docs/api/DiagnosticsChannel.md)。

`tomcatPreFilter` 是**解析起点到 filter**，不是全部服务端入口等待。Tomcat 在开始读取请求行字节时标记起点，accept/poller/executor 等更早等待不在该段内。依据 [Tomcat 请求解析源码](https://raw.githubusercontent.com/apache/tomcat/11.0.x/java/org/apache/coyote/http11/Http11InputBuffer.java)。

`awaitHeadersResidual = clientAwaitHeaders - tomcatPreFilter - preController - controller`，按同一请求相减后汇总，保留正负值。它包含更早入口等待、请求转发、controller 返回后响应准备/写出、客户端调度等，**不是纯网络时间**。Server-Timing 与 JDBC 阶段有包含关系，不能全部相加；详细 JDBC 指标仅对抽中请求统计。

## 实验配置与可比性

- 正式 12 轮，每轮 10,000 次有效写入，并发 100，100 篇文章轮流分配，每篇 100 请求。混合为 5,000 登录浏览 + 5,000 点赞；匿名为 10,000 浏览。
- 同一应用镜像 `air-perf-pool-http:local`，实际 ID：`sha256:20148162e6276d13220ff2735944d1c3ea8bfa76d022972cc716a44124795a20`。
- 基础 Server-Timing/客户端传输全量，JDBC 随机抽样 10%；共抽中 **11,998 / 120,000** 请求。所有正式轮次完整获得 10,000 条 Tomcat 和客户端阶段，missing=0。
- PostgreSQL 18.6，track_io_timing、track_wal_io_timing、pg_stat_statements；fsync/synchronous_commit 开启，wal_sync_method=fdatasync，max_connections=100。
- 发布器最多 200 条一批，每轮最多 4 批，准入预算 250 ms；消费者单并发、批量 100、聚批最多 100 ms，每批一条统计 UPSERT/一次 Redis DEL。
- 每轮重启该实验 app，登录准备不计入 burst；每个栈使用未写过的文章范围，保留旧数据。两个池使用两个独立数据库卷；卷历史与后台维护可能影响结果，不是同一数据库状态的精确回放。
- 池大小按 **10/20/20/10** 顺序，各场景两轮/组。追加客户端路径按 **host/container/container/host**，全部池 20。R9–R12 不纳入前八轮池大小收益计算。
- Windows host 和 Linux container 均 Node **v24.15.0 / Undici 7.24.4**。容器镜像 ID 见 R10/R11 config；镜像 digest 为 `sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f`。
- 客户端、应用与数据库共享本机，没有 CPU/存储资源隔离；开发栈保持运行。各 burst 约 9–11 秒，仅两次重复，不将结果视为生产容量或统计显著性证明。

## 前八轮：池大小对照

所有时间单位为 ms。取连接是基础全量 `dbAcquirePre + dbAcquireController` 每请求累计均值；hold、commit 为 JDBC 抽样均值。p95/p99 为单轮全量 HTTP 延迟。

| 轮次 | 场景 | 池 | 文章范围 | RPS | HTTP p95 | HTTP p99 | 取连接 | hold | commit |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| R1 | 混合 | 10 | 1–100 | 935.2 | 147.7 | 251.3 | 14.62 | 9.061 | 5.548 |
| R2 | 混合 | 20 | 1–100 | 1003.6 | 127.6 | 199.2 | 1.15 | 11.764 | 8.288 |
| R3 | 混合 | 20 | 101–200 | 919.8 | 143.0 | 227.7 | 1.78 | 9.114 | 5.924 |
| R4 | 混合 | 10 | 101–200 | 883.1 | 197.3 | 253.5 | 67.03 | 11.330 | 7.824 |
| R5 | 匿名 | 10 | 201–300 | 909.5 | 185.9 | 448.7 | 52.20 | 10.126 | 7.110 |
| R6 | 匿名 | 20 | 201–300 | 1105.1 | 141.7 | 217.3 | 2.97 | 11.731 | 8.555 |
| R7 | 匿名 | 20 | 301–400 | 1094.2 | 122.2 | 247.4 | 1.91 | 9.728 | 6.460 |
| R8 | 匿名 | 10 | 301–400 | 1048.1 | 171.7 | 235.4 | 38.88 | 9.040 | 5.930 |

合并吞吐按总请求数 / 总 burst 秒计算，详细均值按样本累计耗时 / 总样本数；不平均 p95 得到“合并 p95”。

| 场景 / 池 | 合并 RPS | 取连接均值 | JDBC hold | JDBC commit | commit / hold | 账号 execute | 文章 execute |
|---|---:|---:|---:|---:|---:|---:|---:|
| 混合 / 10 | 908.3 | 40.83 | 10.195 | 6.686 | 65.6% | 0.485 | 0.507 |
| 混合 / 20 | 959.8 | 1.47 | 10.439 | 7.105 | 68.1% | 0.506 | 0.512 |
| 匿名 / 10 | 973.9 | 45.54 | 9.586 | 6.524 | 68.1% | 0 | 0.606 |
| 匿名 / 20 | 1099.6 | 2.44 | 10.721 | 7.499 | 69.9% | 0 | 0.725 |

池 10 的等待探针峰值为 72–83 人；池 20 的前八轮峰值为 0–59 人，均值明显减少但短时等待仍存在。探针采样可能漏掉峰值，并且探针查询本身也需要数据库连接。

因此池 20 是有测量收益的候选。它解除部分池排队，却使更多并发事务进入提交路径；当前 commit 平均成本和其他 HTTP 余量限制了收益。无需仅凭此实验继续放大到 50/100。

## HTTP 阶段：时间仍集中在完整响应头之前

下表均为每请求均值，六段总和为客户端总耗时。入口段、余量是其内的服务端部分与未解释部分，不能再加到总耗时。

| 轮次 | clientTotal | create→send | awaitHeaders | headers→resolve | 正文消费 | tomcatPreFilter | awaitHeadersResidual |
|---|---:|---:|---:|---:|---:|---:|---:|
| R1 | 106.266 | 1.884 | 103.719 | 0.173 | 0.143 | 0.12 | 78.595 |
| R2 | 98.972 | 1.725 | 96.635 | 0.162 | 0.129 | 0.12 | 82.084 |
| R3 | 108.047 | 1.839 | 105.526 | 0.174 | 0.158 | 0.08 | 93.605 |
| R4 | 112.249 | 1.329 | 109.769 | 0.153 | 0.671 | 0.11 | 30.265 |
| R5 | 108.968 | 1.135 | 106.733 | 0.153 | 0.636 | 0.18 | 41.623 |
| R6 | 89.953 | 1.104 | 88.060 | 0.142 | 0.351 | 0.21 | 69.965 |
| R7 | 90.924 | 1.105 | 88.733 | 0.140 | 0.653 | 0.22 | 73.367 |
| R8 | 94.969 | 1.262 | 92.668 | 0.142 | 0.607 | 0.21 | 42.240 |

已解析请求进入最早 filter 很快，正文很小且消费很快；尚未解释的时间在 bodySent 到完整响应头之间。R4 与 R3 的余量、取连接分配差异尤其明显，不能把客户端总时间直接套用到数据库占用模型。

burst 内 Tomcat 工作线程采样：所有轮次最大 active ≤101，配置 maximum=200；队列采样峰值前八轮 ≤3，追加对照 ≤8。没有采到工作线程达到配置上限的证据。该采样不能排除瞬间排队，也不测 poller/accept 到解析起点之间的等待。

## 追加四轮：同版本客户端路径对照

全为匿名浏览、池 20，其余工作负载相同，文章分别 401–500、501–600、601–700、701–800。

| 轮次 | 客户端 | RPS | HTTP p95 / p99 | clientTotal | awaitHeadersResidual | 事件循环延迟 p95 |
|---|---|---:|---|---:|---:|---:|
| R9 | host | 1161.3 | 129.3 / 206.6 | 85.610 | 65.447 | 76.022 |
| R10 | container | 967.1 | 151.5 / 316.9 | 102.744 | 84.733 | 111.935 |
| R11 | container | 997.1 | 158.0 / 324.9 | 99.565 | 81.382 | 111.870 |
| R12 | host | 1093.0 | 120.8 / 205.2 | 90.099 | 70.762 | 81.461 |

合并 host **1126.0 RPS / 68.10 ms 余量**，container **982.0 RPS / 83.06 ms 余量**，容器吞吐约低 12.8%。响应头到 resolve 两端都约 0.14–0.16 ms，clientCreateToSend 在容器约 3.06 ms、host 约 1.36 ms。

路径对照中两轮 Windows host 的 CPU user+system 时间为 1.047/1.156 秒，Linux 容器为 12.832/12.331 秒（单调时钟 burst 10.340/10.029 秒）。进程 CPU 时间可累计多个线程；跨操作系统计数和工作调度不同，不能凭该差值直接判定实现效率。容器与后端共享 Docker VM 资源，是此次对照的额外变量。

客户端事件循环观测说明存在调度/阻塞影响的可能，但尚未建立其对每个请求余量的因果归属。`eventLoopUtilization` 不是 CPU 利用率；`monitorEventLoopDelay` 使用 10 ms resolution，直方图包括该采样间隔，不能把分位数直接等同于每请求等待。依据 [Node 官方 perf_hooks 文档](https://nodejs.org/api/perf_hooks.html)。

## WAL/IO 与异步尾部

前八轮 WAL 单次 fsync 均值 **2.984–4.842 ms**，write **0.060–0.353 ms**；累计 WAL write+fsync 时间中同步占 **92.4%–98.6%**。持续采到 `IO:WalSync` / `LWLock:WALWrite`，锁等待类型 `Lock` 峰值均 0。R5 另观察到 autovacuum 的 `Timeout:VacuumDelay`。十二轮均无 checkpoint 增量、deadlock 或 pg_stat_statements dealloc。

这些是共享窗口内 PG 累计值，包含后台、HTTP、发布消费与探针，统计刷新可能带入之前准备阶段的少量活动；不能直接换算成每请求 fsync 次数或物理磁盘延迟。prepared COMMIT utility 覆盖不完整的限制与前一篇报告相同。

各轮同一 burst 起点下的实际日志时间：

| 轮次 | HTTP 完成 s | 最后发布 s | 最后消费 ACK s | outbox 峰值 | ready 峰值 |
|---|---:|---:|---:|---:|---:|
| R1 | 10.694 | 10.808 | 10.914 | 401 | 51 |
| R2 | 9.965 | 10.077 | 10.187 | 340 | 0 |
| R3 | 10.872 | 10.976 | 11.086 | 261 | 0 |
| R4 | 11.324 | 11.409 | 11.532 | 372 | 101 |
| R5 | 10.996 | 11.154 | 11.260 | 1550 | 99 |
| R6 | 9.050 | 9.089 | 9.197 | 1091 | 45 |
| R7 | 9.139 | 9.242 | 9.348 | 766 | 0 |
| R8 | 9.541 | 9.675 | 9.778 | 1594 | 56 |
| R9 | 8.612 | 8.661 | 8.781 | 609 | 0 |
| R10 | 10.340 | 10.397 | 10.506 | 260 | 0 |
| R11 | 10.027 | 10.096 | 10.201 | 303 | 0 |
| R12 | 9.150 | 9.305 | 9.410 | 1312 | 0 |

本表按客户端墙钟 burst 起点与日志墙钟对齐；单调时钟 HTTP burst 与墙钟区间存在约 1–3 ms 差异，不做跨机精确延迟归因。最后 ACK 比 HTTP 完成晚 **147–264 ms**，没有持续增长的异步尾部。R4 `pipeline-drained` 管理观测为 39.869 秒，但实际最后 ACK 为 11.532 秒，计数收敛检查第一次即成功；其管理/探针最大耗时 1235 ms。排空轮询还受管理统计刷新与调度影响，不能将 39.869 秒解释为消费者花了这么久。

## 正确性、测试与收尾

十二轮 **120,000** 次有效写入（100,000 浏览、20,000 点赞），每轮全量 Confirm/marked/applied=10,000；发布失败、消费者 duplicate/reject/requeue、缓存删除失败均 0。JDBC 抽样借出=归还，SQL/commit/close 失败、rollback 均 0：混合每样本 3 次借出/4 SQL/1 commit，匿名 2/3/1。各轮逐篇事实与统计一致，outbox=processed=10,000，最终四个队列 ready/unacked 均 0。

全库最终复核（每库含 2,000 篇夹具）：

| 实验项目 | 浏览事实 / 统计 | 点赞事实 / 统计 | outbox / processed | 未发布 / 错误文章 / 测试 schema |
|---|---:|---:|---:|---:|
| pool-ten | 30,100 / 30,100 | 10,000 / 10,000 | 40,100 / 40,100 | 0 / 0 / 0 |
| pool-twenty | 70,000 / 70,000 | 10,000 / 10,000 | 80,000 / 80,000 | 0 / 0 / 0 |

pool-ten 另含 100 次冒烟浏览，文章 1901–2000，不计入正式吞吐。

Java 回归 **56 项通过，无跳过**：JDBC 5、filter 4、Tomcat Valve 1、真实 PG 集成 5、消费者 20、发布器 18、缓存 3。Node **2 项通过**：并发请求关联/阶段分割、缺失和逆序拒绝。正式测试和运行镜像完成构建。未更改点赞/浏览成功语义、事实/outbox 原子事务或开发栈参数。

已停止本次两个实验项目，保留卷和原始记录。仅原开发栈四个容器继续运行。

## 后续顺序

1. **独立客户端、固定速率与并发阶梯。** 在另一台机器使用相同 Node/Undici，先比较同机/独立客户端；保持池 20、耐久性和批量配置，测并发 20/50/100 与固定到达速率。记录客户端事件循环、服务端 CPU/调度、HTTP/ACK 吞吐和等待，区分客户端供给、服务端处理及闭环回压。已有池 10/20 结果可作候选依据，不把 +5.7%/+12.9% 当作独立机器上的保证。
2. **补齐解析前和响应写出边界。** 先评估可关联请求的 Tomcat executor enqueue→run 计时及服务端响应头写出/flush 边界，必要时在隔离环境做网络时间戳观测。统一时间边界或用同机单调时钟，避免跨机器墙钟相减；目前不能给几十毫秒余量一个确定归因。
3. **若独立客户端仍确认 commit/存储限制吞吐**，用新卷对照存储路径并继续保持 fsync/synchronous_commit。当前连接持有里 commit 是首要已测成本；入口批量事实/outbox 写入可降低事务次数，但涉及成功返回和重试语义，需单独设计与正确性验证。

## 记录与复现

前八轮 Labels：`pool-r1-ten`、`pool-r2-twenty`、`pool-r3-twenty`、`pool-r4-ten`、`pool-r5-ten`、`pool-r6-twenty`、`pool-r7-twenty`、`pool-r8-ten`，统一后缀 `-2026-09-26`。追加为 `pool-r9-host`、`pool-r10-container`、`pool-r11-container`、`pool-r12-host` 加同后缀。配置、客户端 JSONL、PG 快照、发布消费日志、队列和逐篇核对在 ignored 的 target。

跨轮汇总：`target/pool-twelve-http-2026-09-26.jsonl`、`target/pool-twelve-pg-2026-09-26.jsonl`、`target/pool-twelve-pipeline-2026-09-26.jsonl`；核对与组均值：`target/pool-final-check-2026-09-26.json`。全库核对：`target/air-perf-drain-pool-{ten,twenty}-final-validation-2026-09-26.json`。Java：`target/pool-http-tests-2026-09-26.log`；Node：`target/pool-http-node-tests-final-2026-09-26.log`。

R1 后增加客户端完成秒桶输出，R6 前补充 runtime 的 platform/arch 元数据，R9 前加入容器客户端选项；前八轮均为 host，全局计时边界不变、应用镜像一致。不要把较早轮次缺失的补充元数据当作零，R1 无客户端完成秒桶仍有全量全局阶段和 JDBC/取连接时间轴。

新环境按 perf README 准备凭据/夹具目录，构建当前源码，使用新项目和新 Label；已有卷复用时省略 Seed、改用未写过的文章范围：

```powershell
docker build -t air-perf-pool-http:local .
./perf/run-metric-experiment.ps1 -Project air-perf-drain-pool-example `
  -Label pool-example -AppPort 18281 -RabbitPort 18282 `
  -Image air-perf-pool-http:local -PoolSize 20 -HttpTransportTiming `
  -JdbcTiming -JdbcSampleRate 0.1 -PostgresCounters `
  -ArticleCount 100 -ArticleOffset 1 -Seed -StopStack
node perf/summarize-http-jdbc.mjs target/pool-example
node perf/summarize-postgres-io.mjs target/pool-example
node perf/summarize-metric-experiments.mjs target/pool-example
node --test perf/http-transport-timing.test.mjs
```

容器客户端先准备 `docker pull node:24.15.0-alpine`，另一轮加 `-ClientLocation container`。脚本只停止明确实验项目，不删除卷或覆盖历史 Label；凭据通过环境传入。
