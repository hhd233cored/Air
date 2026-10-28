# 批量标记语句关闭 server prepare：完整链路对照

日期：2026-09-27。前置诊断见[实际计划与同连接等待](RESULTS-ARTICLE-METRICS-PLAN-WAITS-2026-09-27.md)。本轮只改变 `markPublishedBatch` 的语句级 prepareThreshold，验证 generic 计划风险与完整链路的变化。

后续stats SQL拆测已完成：见[消费者实际计划与组件实验](RESULTS-ARTICLE-METRICS-STATS-PLANS-2026-09-27.md)。主要成本定位到点赞count的重复扫描及可见性回表，以下保留本轮结果。

## 结论

- 单语句关闭server prepare已实现并验证；捕获的generic慢计划从A组852个降为B组0个，整轮mark SQL p95从59.382降为31.518ms。
- 完整链路没有稳定提速：加权HTTP为A981.938/B971.224 RPS，B1出现97次恢复重试。候选保留为显式开关，最终默认false。
- 四轮1,172,684次有效写入全部核对正确。下一步优先拆消费者stats SQL实际计划（耗时占比61%–64%），再验证发送/背压和WAL等待。

## 改造与回归

`ArticleMetricRepository.markPublishedBatch` 使用同一事务数据源的 `JdbcTemplate` 创建 PreparedStatement，UUID 继续用 `setObject` 绑定；仅该语句调用 `unwrap(PGStatement.class).setPrepareThreshold(0)`。仍是一条 UPDATE、一次提交，保留 `published_at IS NULL` 幂等条件。创建或参数绑定失败会关闭语句并向上传播异常。

产品配置 `airchord.article-metric.mark-server-prepare-disabled`，环境变量 `ARTICLE_METRIC_MARK_SERVER_PREPARE_DISABLED`。**最终默认 false，保留驱动原阈值5；true 显式启用候选阈值0。** 四轮 SQL 尾延迟改善，但 HTTP 吞吐未稳定提高，B1 出现恢复重试，候选暂不默认启用。其他语句和连接策略未调整。PG 驱动由 runtime 依赖改为编译依赖，版本未变。

真实 PG 回归覆盖 true/false 两组，每组同一物理连接 15 次 200 行更新后回滚、最终提交、重复/空批次幂等、连接归还。实测 mark 阈值分别 0/5，关闭组无对应 named prepared statement；同连接默认阈值与另一条 SELECT 阈值均保持 5。Java 64 项通过、0 失败/错误/跳过；Node 9 项通过，收尾再次通过9项。日志位于 `target/markcustom-java-tests-2026-09-27.log`、`target/markcustom-node-tests-2026-09-27.log` 与 `target/markcustom-final-node-tests-2026-09-27.log`。

## 相同初始状态与实验方法

- 原隔离库已停止后物理复制到封存快照，仅在副本对 outbox 执行 ANALYZE，使每轮从 pending=0、published_at null_frac=0 的统计开始；原库数据和统计未参与这一步修改。
- 每轮独立复制封存快照，启动前核对所有普通文件内容的聚合 SHA-256：`996b4fa4c23168a76ae50690e9c793f8463f6994f4e80c6a90720a3bda5b2838`。相同物理布局/历史数据/统计；进程与文件缓存不能保证完全相同。
- 初始 views=1,084,111、likes=1,083,873，outbox=processed=2,167,984；pending=0。各正式轮复用相同未使用的 1201–1300 号文章，互相独立，不能将各副本累计值相加当作原库总量。
- 冒烟：独立副本、1401–1500 号文章、3 秒/20 RPS，60 浏览全部完成，实际 mark 阈值全为 0，最终计数一致。
- 正式顺序 A1/B1/B2/A2；A=false/阈值5，B=true/阈值0；同一镜像 `air-perf-markcustom:local`，SHA `aae41dd965b332ea0b3aff03f21b7e13eb7f435de997b14d1e230e606f467946`。
- 每轮混合 300 秒、目标 1,000 写请求/秒、并发200、100篇文章、4个发压 worker；连接池总20（HTTP16/后台4）、发布4×200/250ms预算、消费者100/100ms。登录准备排除在负载窗口外，没有额外排除完整链路预热段。
- 同时采集 HTTP/JDBC（HTTP采样10%、mark全量）、publisher/consumer、PG counters、≥20ms auto_explain 实际计划、同 backend PID 等待（目标20ms）、Linux（目标250ms）、WSL内存（目标1秒）、JFR。A/B采集设置相同。
- Docker 地址池在 A1 启动前耗尽，未产生该轮请求；正式轮顺序复用已停止冒烟实验的网络，数据库/Redis/Rabbit卷各自独立，历史网络/数据卷保留。
- 所有服务、发压和观察仍共用本机 WSL；这是同机对照，不能视为独立客户端的服务器容量上限。

## 测量结果

### 逐轮完整链路

所有已发送请求均获得预期 changed 结果，无 HTTP/事务/缓存错误，最终逐篇事实计数=统计计数、outbox=processed，待发布和全部 RabbitMQ 队列均为0。计划到达因并发或调度预算未发送的比例分别为2.301%、3.549%、2.067%、1.187%，单独记账，未算作服务器成功或业务错误。

| 轮次 | 有效写入 | HTTP RPS | HTTP p95 ms | outbox峰值 | Rabbit ready峰值 | 最后消费完成尾部 秒 | 发布确认失败/恢复重试 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 阈值5 | 293,096 | 976.2 | 112.6 | 14,914 | 2,932 | 17.949 | 0 |
| B1 阈值0 | 289,352 | 963.6 | 181.8 | 8,952 | 19,736 | 17.550 | 97 |
| B2 阈值0 | 293,798 | 978.9 | 115.1 | 1,888 | 9,852 | 10.685 | 0 |
| A2 阈值5 | 296,438 | 987.7 | 99.5 | 6,960 | 11,003 | 14.762 | 0 |

尾部从 HTTP 窗口结束计算到最后消费者批次日志（提交、缓存失效及 ACK 调用返回之后）；Rabbit 管理探针确认排空更晚，不能把两者混为同一个指标。上述 HTTP p95 为单轮请求分位数，没有平均。

四轮共1,172,684次有效写入，各轮独立副本。A 两轮按 HTTP 时长加权为981.938 RPS，B为971.224（低约1.1%）；包括异步尾部的全批完成吞吐分别为931.202、927.604 RPS。两次重复和共享 WSL 的波动不足以证明整链路提速或给出独立服务器容量上限。

### mark SQL 与提交

下表合并各组原始批次计算分位数；A=3,247批、B=3,111批；固定200行满批次分别1,520、2,114批。

| 指标 ms | A 阈值5 | B 阈值0 |
| --- | ---: | ---: |
| SQL平均 / p95 / p99 | 21.864 / 59.382 / 127.749 | 17.205 / 31.518 / 44.446 |
| 固定200行SQL平均 / p95 | 30.392 / 95.228 | 18.751 / 33.900 |
| commit平均 / p95 / p99 | 9.702 / 14.397 / 61.220 | 11.143 / 18.978 / 84.522 |
| mark整个调用平均 | 31.991 | 28.821 |
| mark取连接平均 | 0.003 | 0.002 |
| 前90秒SQL平均 / p95 | 12.735 / 21.450 | 19.200 / 38.447 |
| 前90秒固定200行SQL平均 | 16.176 | 21.457 |

整轮 SQL 均值降低约21.3%、p95降低约46.9%；固定200行均值降低约38.3%。commit均值更高，整个mark调用均值仅降低约9.9%。**前90秒两种口径都更慢**，需要保留分段结果；同初始状态不会保证负载中的pending规模、缓存和资源竞争完全相同，不能把均值差异全部解释成计划策略的纯效果。

### 实际计划与等待证据

- 每个实际执行mark语句的批次阈值均核对通过：A=5、B=0。≥20ms实际计划全部按同backend PID与execute跨度匹配，无未匹配计划。
- A1/A2捕获385/531个慢计划，其中359/493个是pending索引加参数占位符（generic特征）；B1/B2捕获396/391个，generic特征均为0。B1仍有395个、B2有391个custom计划扫描pending索引，仅B1有1个主键bitmap路径。该改动缓解generic慢扫描，pending扫描成本仍随积压变化。
- 同连接COMMIT仍出现WALWrite锁等待、WalSync持久化等待等；A1最长362.681ms，采到WALWrite×19，JFR socket362.228ms；B1最长318.588ms，采到WALWrite×6、WalSync×8，JFR318.445ms。局部时钟对齐后这两例没有GC pause重叠。WALWrite等待不能等同于该连接自身fsync耗时。
- PG等待实际平均间隔约20.0–20.1ms，最长单次间隔B1达1,021ms，短等待可能漏采，次数不能当持续时间分位数。JFR墙钟偏移约十几至几十ms，单调耗时优先。
- Linux CPU busy各轮均值54.7%、61.4%、58.1%、58.9%；VM MemAvailable最低约2.42GiB，PG无cgroup节流。本轮证据未把内存容量列为首要限制；Windows进程CPU字段不可读，保持为空。

### B1恢复重试的核验

B1原来的严格“零失败”汇总拒绝结果，因为claimed=sent=289,449、confirmed=marked=289,352、failures=97。业务事实与最终消费计数仍正确。

采用显式 `--allow-publisher-retries` 做恢复重试核验：逐批claimed=sent，confirmed=markRequested=marked，failures=sent-confirmed；总confirmed/marked/received/applied均等于有效写入，消费者重复/拒绝/重排、SQL/提交/缓存错误仍为0，全部队列最终为0。B1保留标记 `PASS_WITH_PUBLISHER_RETRIES`；A1/B2/A2为 `PASS`。数据库范围内97条记录attempt_count=1，总延期次数97，核对到日志中97次失败；没有未恢复事件。

队列配置为max-length=20,000、reject-publish，B1采样ready峰值19,736，失败集中在负载末段。这支持容量背压的解释，但现有确认日志将NACK/Return合并处理，未单独记录broker原因，不能把每次失败都断言为容量拒绝。队列容量保持原值。

## 当前限制与下一步

1. **消费者stats SQL优先拆实际计划。** 四轮stats SQL均值42.361/50.363/46.058/47.470ms，占消费者耗时约61%–64%。该语句包含每篇点赞事实count和统计UPSERT，应在同快照下分别核对count子计划、索引/heap访问、锁等待和UPSERT成本，再选择改造。现有阶段计时不足以断言count独占整个SQL耗时。
2. **发布器发送与背压。** 按组批次加权，claim均值A/B为27.132/32.238ms、send59.822/68.431ms、Confirm剩余等待4.502/5.114ms，仍大于mark SQL；结合Rabbit ready峰值与B1重试，下一轮拆send中的通道/网络/调度，并验证消费者处理能力和发布预算的配合。增加队列容量会延长排队，当前结果未验证其收益。
3. **HTTP提交与WAL。** 账号/文章SQL约0.5–0.7ms，HTTP JDBC提交约8–10ms，占连接持有时间约73%。后台池pending=0、mark取连接约微秒级，先继续核对提交等待与存储资源，维持fsync/synchronous_commit开启；不优先扩大连接池。pending-ID索引与统计策略仍是mark后续候选，需要连同写入/WAL维护成本再测。

候选开关保留、默认false；当前报告验证了SQL尾延迟收益，完整链路的限制仍在消费者统计写入、消息发送与提交等待。

## 产物与状态

- [四轮对照详情](markcustom-2026-09-27-comparison.json)、[对照CSV](markcustom-2026-09-27-comparison.csv)、[整链路逐轮CSV](markcustom-2026-09-27-rounds.csv)、[逐秒连接/队列/等待](markcustom-2026-09-27-timeline.csv)。
- [完整阶段和事件滞后](markcustom-2026-09-27-detail.json)、[JFR尖峰](markcustom-2026-09-27-spikes.json)、[PG/WAL区间](markcustom-2026-09-27-pg-intervals.csv)。事件滞后用数据库事务起点之差，未包含消费提交、缓存和ACK，不能视为逐事件端到端提交p95。
- 原始日志、编排、sealed snapshot、manifest 与逐轮核验位于 `target/markcustom-*`。五份副本的初始文件hash相同；每份最终全库计数=初始状态+本轮增量，2000篇夹具逐篇核对，wrongArticles/unpublished/testSchemas=0，outbox=processed。`target/markcustom-final-validation-2026-09-27.json`保留各副本总数。
- 汇总保留了B1零失败检查拒绝及随后恢复重试核验的记录，未重放B1负载；Docker地址池异常发生在A1发压前，原始失败setup日志与恢复编排也保留。
- 四轮测量使用上文同一镜像SHA，实验开关均显式设置。根据结果将产品默认改为false后重新构建，最终 `air-perf-markcustom:local` SHA为`285fee27956e0c52fa8c4efceb8613fee72ea31f41168345fdd4906e599ea016`；只修改默认配置值，true/false两种运行路径均由上述回归和完整链路验证。最终构建日志`target/markcustom-final-default-build-2026-09-27.log`。
- 本轮隔离栈、测试助手和观察作业已结束，数据卷与记录保留；原开发栈四个容器继续运行。原隔离历史卷未叠加这些独立副本的增量。
