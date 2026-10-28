# 文章指标：10% JDBC 抽样与 PostgreSQL WAL/IO 复测

日期：2026-09-26。接续 [HTTP JDBC 拆测](RESULTS-ARTICLE-METRICS-HTTP-JDBC-2026-09-26.md)。本次完成抽样开/关交替对照、WAL/IO 增量采集及匿名复测，未调整业务写入、耐久性或生产连接池。

## 结论

当前证据进一步指向 **有效写事务的提交、WAL 同步，以及共享连接池排队**。这是数据库连接持有成本的主要来源；不能据此把全部 HTTP 延迟都归因于数据库。

- 混合请求抽样平均 commit **6.412 ms**，占连接持有时间 **64.43%**；匿名浏览为 **7.142 ms / 67.08%**。
- 混合请求账号、文章 JDBC execute 分别 **0.493 / 0.504 ms**。服务端相应类别 SQL 执行均值约 **0.030–0.032 / 0.050–0.053 ms**，目前不支持把这两个查询当作主要 SQL 瓶颈。
- 六轮 WAL 同步均值 **3.040–4.604 ms**，写入均值 **0.070–0.104 ms**。WAL 写入+同步累计耗时中，同步约占 **97%–98%**。采到 `IO:WalSync`、`IO:WalWrite`、`LWLock:WALWrite` 等等待。
- 基础取连接计时仍为全量；各轮平均取连接合计 **10.27–71.28 ms**，探针观察到池 10 全忙、最多 **82** 个等待线程。
- 抽样组与关闭组混合汇总吞吐相差 **+2.89%**，本轮未复现上轮全量详细计时约 7.4% 的下降。每组仅两轮且 IO 延迟有变化，不能证明抽样零开销。

账号/文章定位租用连接仍有成本，但优先级应放在提交/存储同步和并发资源对照，而不是立即增加账号缓存或改文章索引。

## 实验与采集口径

两个新项目：`air-perf-drain-pgio-off`（18211/18212）和 `air-perf-drain-pgio-sample`（18221/18222）。旧实验数据、卷及开发栈保持原状。各轮停止后重新启动应用，登录准备不计入 RPS。

统一镜像 `air-perf-pg-io:local`，实际 ID：

`sha256:79c78a6c156198cc25141892d8ad85a7446738dcbdb649dd93278339ddb5326a`

PostgreSQL 18.6、Hikari 10、消费者单实例/批量 100/等待 100 ms、发布器最多 4 批/下批准入预算 250 ms。发布器产品默认仍为 1 批。每轮 100 篇文章，10,000 次有效写入，并发 100；混合为 5,000 个已登录用户各浏览一次再点赞一次，匿名为 10,000 次浏览。

全组同时开启 `track_io_timing`、`track_wal_io_timing` 和 `pg_stat_statements`，保持 `fsync=on`、`synchronous_commit=on`、`wal_sync_method=fdatasync`。开/关对照都承担相同的 PostgreSQL 采集成本，不能与以前 IO timing 关闭的轮次直接比较绝对吞吐。

抽样只影响详细 JDBC：每个带 `X-Perf-Timing: 1` 的文章写请求独立随机选择 10%，避免固定每第十个请求偏向浏览/点赞。基础 Server-Timing、HTTP 和业务结果仍统计全部请求；详细均值/分位数只使用抽中样本。默认详细计时关闭，sample rate 默认 1 保持原有全量模式。

累计计数快照分别在登录准备后等待 1.5 秒、HTTP 完成后、队列排空后再等待 1.5 秒取得，不重置 PG 统计。以下 WAL/IO 表使用 **before-burst → after-drain** 的差值，覆盖 HTTP、发布、消费、探针、后台活动与尾部；after-http 原始快照亦保留，但可能受 PG 累计统计刷新滞后影响。快照内多条查询也非原子瞬时快照，保留起止时间。

PostgreSQL 18 的 WAL I/O 时间在 `pg_stat_io` 中，计时列含义见 [官方统计文档](https://www.postgresql.org/docs/18/monitoring-stats.html) 和 [18 版本变更](https://www.postgresql.org/docs/18/release-18.html)。WAL 同步次数不等于请求/事务数，多个事务可能共享同步；累计 IO 时间不能直接分摊成每个 HTTP commit 的耗时。

## 六轮结果

| 轮次 | 场景 / 详细计时 | 文章范围 | 有效写入/s | HTTP p95 ms | JDBC 样本 | 全量取连接均值合计 ms |
|---|---|---|---:|---:|---:|---:|
| R1 | 混合 / 关闭 | 1–100 | 976.2 | 132.0 | 0 | 10.27 |
| R2 | 混合 / 10% | 1–100 | 944.6 | 188.4 | 1,020 | 71.28 |
| R3 | 混合 / 10% | 101–200 | 1,007.9 | 146.9 | 957 | 22.18 |
| R4 | 混合 / 关闭 | 101–200 | 921.1 | 185.6 | 0 | 42.03 |
| R5 | 匿名浏览 / 10% | 201–300 | 897.0 | 215.3 | 1,001 | 66.69 |
| R6 | 匿名浏览 / 10% | 301–400 | 946.9 | 194.5 | 1,022 | 44.51 |

AB/BA 混合对照合计 20,000 请求分别除以两轮实测突发总时长：关闭组 **947.822/s**，抽样组 **975.229/s**。这是合计吞吐差，不是抽样带来的性能增益；没有独占主机、固定资源配额或置信区间。匿名没有 5,000 个登录的预热，事实类型也不同，不宜直接用混合/匿名吞吐差估计鉴权成本。

混合详细样本 1,977，其中浏览 1,002、点赞 975。全体详细样本 4,000，借出/归还均 **9,977**，JDBC execute **13,977**，commit **4,000**；SQL/commit/close 失败及回滚均 0。每个混合样本 3 次租用、4 次 execute、1 次 commit；匿名 2 次租用、3 次 execute、1 次 commit。

## JDBC 成本排序

下表按各轮样本累计耗时/总样本数汇总，不把各轮均值简单平均。持有时间包含 SQL、commit、读取等项，不能再次相加。

| 每个抽样请求均值 | 混合（1,977） | 匿名浏览（2,023） |
|---|---:|---:|
| 所有连接持有 ms | 9.952 | 10.648 |
| 账号连接持有 ms | 0.883 | 0 |
| 文章连接持有 ms | 0.779 | 1.140 |
| 写事务连接持有 ms | 8.291 | 9.508 |
| JDBC execute 合计 ms | 2.384 | 2.335 |
| 账号 SQL execute ms | 0.493 | 0 |
| 文章 SQL execute ms | 0.504 | 0.666 |
| 事实 SQL execute ms | 0.791 | 0.928 |
| outbox SQL execute ms | 0.596 | 0.741 |
| 直接 JDBC commit ms | **6.412** | **7.142** |
| 写事务占持有时间 | 83.31% | 89.29% |
| commit 占持有时间 | **64.43%** | **67.08%** |

R2/R3 commit 分别 7.288/5.477 ms，p95 9.8/7.8 ms；R5/R6 分别 7.759/6.538 ms，p95 11.2/10.0 ms。详细 execute 包括驱动、网络、PG 和结果传输，服务端语句执行均值不包含这些客户端成本。服务端按表名分类还包含正常探针鉴权和读取统计时的定位查询，不等于只看 HTTP 写请求。

抽样连接占用推算使用样本均值 × 全量 RPS，R2 甚至得到 10.134，而池只有 10；这是抽样/测量扰动下的估计，不能当作精确占用，也不能据此算出生产应增加多少连接。

## WAL / IO 增量

| 轮次 | WAL 生成字节 | WAL 同步次数 | 同步均值 ms | 同步累计 ms | WAL 写均值 ms | 非 WAL 文件读取累计 ms |
|---|---:|---:|---:|---:|---:|---:|
| R1 | 16,198,577 | 3,117 | 3.040 | 9,475.799 | 0.090 | 2.465 |
| R2 | 14,696,956 | 2,307 | 4.392 | 10,131.973 | 0.085 | 2.095 |
| R3 | 17,026,982 | 2,919 | 3.143 | 9,175.786 | 0.080 | 10.179 |
| R4 | 18,539,670 | 2,438 | 4.217 | 10,280.167 | 0.096 | 95.163 |
| R5 | 17,761,712 | 2,319 | 4.604 | 10,676.246 | 0.070 | 30.837 |
| R6 | 22,203,809 | 2,630 | 3.605 | 9,480.562 | 0.104 | 70.845 |

六轮窗口内完成 checkpoint 数、WAL buffers full 增量、deadlock、pg_stat_statements dealloc 均 **0**；统计 reset 时间未改变。没有观察到这几个计数代表的压力，500 ms 等待采样仍不能排除短暂锁等待。

IO 数字和 JDBC commit 同方向变化：混合 R2 的 WAL 同步 4.392 ms / JDBC commit 7.288 ms，R3 为 3.143 / 5.477 ms；匿名 R5 为 4.604 / 7.759 ms，R6 为 3.605 / 6.538 ms。它们支持同步持久化是提交的重要来源，不能相减当作剩余纯网络延迟：集群同步涉及其他事务、group commit、WAL 锁及调度。

这里测得的是 Docker/虚拟机存储路径向 PostgreSQL 提供的 write/fsync 延迟，尚未取得能可靠映射到物理磁盘的宿主机设备延迟；物理设备层的耗时仍未定位。

### 服务端 COMMIT 计时的限制

pg_stat_statements 的 COMMIT utility 增量只有 R1–R6 的 **7/6/6/7/8/8 次**，无法覆盖 10,000 次写事务，其极小均值不可信为真实提交延迟。因此汇总仅输出 `commitUtilityAvgMs/commitUtilityCalls`，不称为服务端耐久提交均值；本轮没有完成可靠的服务端 COMMIT 与 JDBC commit 全量一一对照。

预备 utility 的 queryId 生命周期可能影响覆盖；[PostgreSQL 18 源码](https://github.com/postgres/postgres/blob/REL_18_STABLE/contrib/pg_stat_statements/pg_stat_statements.c) 在 utility 钩子中清零 queryId，且因事务命令可能释放结构而不恢复它。这里是对覆盖异常的源码解释线索，结论使用实际覆盖计数而不依赖此推断。

## 异步尾部与尚未拆清的 HTTP 时间

| 轮次 | HTTP 完成 s | 最后发布完成 s | 最后消费者 ACK s | outbox 峰值 | ready 峰值 |
|---|---:|---:|---:|---:|---:|
| R1 | 10.244 | 10.308 | 10.468 | 361 | 0 |
| R2 | 10.586 | 10.666 | 10.773 | 472 | 100 |
| R3 | 9.922 | 10.007 | 10.128 | 313 | 0 |
| R4 | 10.857 | 10.948 | 11.075 | 291 | 188 |
| R5 | 11.148 | 12.065 | 12.183 | 1,770 | 500 |
| R6 | 10.562 | 10.760 | 10.876 | 1,723 | 99 |

以上均为同一客户端 burst 起点。最后 ACK 比最后发布晚 **107–160 ms**，本轮没有持续消费积压；R5 发布尾部仍约晚于 HTTP 0.917 秒。管理接口排空观测为 13.873–17.733 秒，受管理统计刷新和轮询影响，不可替代发布/消费日志的真实完成时间。

HTTP 总耗时减最早 Servlet filter 到 controller 返回的时间仍有较大未拆清部分：R1–R6 平均 **81.66/21.86/65.38/54.19/30.72/47.83 ms**。可能包括服务端进入过滤器前的等待、客户端排队/调度、网络及响应处理；现在无法区分。它和连接排队在不同轮次之间分配变化明显，所以“SQL execute 不是主成本”“数据库持有主要是 commit”不等于“HTTP 全部延迟都是 commit”。

## 正确性与收尾

正式六轮 **60,000** 次 HTTP 有效写入，全部 Confirm、批量 marked、applied；发布失败、消费者 reject/requeue、缓存删除失败均 0。各轮逐篇事实与统计一致，outbox/processed 相等，所有指标队列 ready/unacked 最终为 0。

全库复核：

| 项目 | 浏览事实/统计 | 点赞事实/统计 | outbox/processed | 未发布 / 错误文章 / 测试 schema |
|---|---:|---:|---:|---:|
| pgio-off | 10,100 / 10,100 | 10,000 / 10,000 | 20,100 / 20,100 | 0 / 0 / 0 |
| pgio-sample | 30,000 / 30,000 | 10,000 / 10,000 | 40,000 / 40,000 | 0 / 0 / 0 |

off 另含 100 次独立冒烟浏览（文章 1901–2000），不计入正式吞吐。测试 **54 项通过，无跳过**：JDBC 5、抽样 filter 3、真实 PG 集成 5、消费者 20、发布器 18、缓存 3。首次离线测试因缺少 surefire provider 依赖失败，在线补齐后通过；保存两份日志。另验证首请求未抽中时仍正确汇总详细指标并按抽中样本数计算。

完成后停止本次两个实验项目，保留卷和结果；仅开发栈四个容器运行，其启动时间未改变。

## 下一步建议

以下第 1、2 项的连接池、Tomcat 解析起点和客户端路径对照已完成，见 [连接池与 HTTP 路径实验记录](RESULTS-ARTICLE-METRICS-POOL-HTTP-2026-09-26.md)。独立客户端及解析前等待仍待进一步验证。

1. 先做 **池 10 / 20 的隔离对照**，保持耐久性、负载、WAL/IO 采集一致，看吞吐、尾延迟、WAL 同步/锁等待、异步供给是否改善。更多连接可能提高 group commit，也可能增加竞争；由对照决定。
2. 同时补充进入最早过滤器之前及客户端发送/首字节/读完响应的时间口径，条件允许时将压测客户端放到独立机器，解释上述尚未拆清的 HTTP 部分。
3. 若更大池只是增加 WAL 等待，再比较独立新数据库卷的存储路径或评估有耐久保证的入口批量写入。批量入口涉及返回成功和失败重试语义，应另行设计；本轮未改变每请求事实/outbox 原子提交。

## 原始记录与复现

Labels：`pgio-r1-off-2026-09-26`、`pgio-r2-sample-2026-09-26`、`pgio-r3-sample-2026-09-26`、`pgio-r4-off-2026-09-26`、`pgio-r5-anonymous-2026-09-26`、`pgio-r6-anonymous-2026-09-26`。配置、客户端 JSONL（含三个 PG 快照）、发布/消费日志及逐篇核对均在 ignored 的 `target/`。

跨轮汇总：`target/pgio-http-summary-2026-09-26.jsonl`、`target/pgio-postgres-summary-2026-09-26.jsonl`、`target/pgio-pipeline-summary-2026-09-26.jsonl`。全库核对：`target/air-perf-drain-pgio-{off,sample}-final-validation-2026-09-26.json`；回归：`target/pgio-tests-online-2026-09-26.log`。

新环境准备 perf README 中的凭据/目录，构建当前源码，再用新项目与新 Label：

```powershell
docker build -t air-perf-pg-io:local .
./perf/run-metric-experiment.ps1 -Project air-perf-drain-pgio-example `
  -Label pgio-example -AppPort 18251 -RabbitPort 18252 `
  -Image air-perf-pg-io:local -ArticleCount 100 -ArticleOffset 1 `
  -JdbcTiming -JdbcSampleRate 0.1 -PostgresCounters -Seed -StopStack
node perf/summarize-http-jdbc.mjs target/pgio-example
node perf/summarize-postgres-io.mjs target/pgio-example
node perf/summarize-metric-experiments.mjs target/pgio-example
```

关闭详细计时省略 JdbcTiming；各组仍开启 PostgresCounters。复用自己的实验项目时用未写过的文章范围并省略 Seed。不要覆盖历史镜像/Label，脚本不删除卷、不清空数据、不输出凭据。
