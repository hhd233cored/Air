# 批量标记实际计划与提交等待：2026-09-27

后续验证已完成：单mark语句的prepare开关、同快照A/B/B/A四轮五分钟对照见[后续完整链路记录](RESULTS-ARTICLE-METRICS-MARK-CUSTOM-2026-09-27.md)。SQL尾延迟改善，完整链路未稳定提速，候选默认false；以下保留本次诊断时的结果与计划。

## 结论

本次继续上一轮的三个诊断步骤，完成实际慢 UPDATE 计划、同一连接的 PG 等待/JFR/WSL 观测，以及隔离副本的固定数据 SQL 对照。

1. **已重现的持续慢段来自错误估计下的待发布索引扫描，并受到 generic 预编译计划影响。** 更新200行时扫描、过滤数万条其他待发布记录。最慢样本 JDBC UPDATE375.202 ms，PG实际执行373.430 ms，扫描节点过滤31,714行，缓冲读盘为0。不能再用取连接或账号/文章查询解释这一批的慢 UPDATE。
2. **提交长尖峰明确涉及 WAL 同步/串行写入等待。** 最大commit321.673 ms，同一后端PID采到3次`LWLock/WALWrite`、13次`IO/WalSync`，JFR socket等待321.435 ms。另有只采到`WALWrite`的190/187 ms尖峰，表示可能等待另一后端持有WAL写锁；不能把所有尖峰均称为本连接磁盘fsync。
3. **候选 ID 索引在陈旧统计下没有自动被选中。** 参数化固定数据对照中，generic现有索引101.592 ms、custom现有索引5.495 ms；刷新统计后generic现有索引1.913 ms，再加pending-ID索引1.327 ms。建议优先验证仅mark语句的预编译策略，随后判断索引是否值得增加。

这些SQL对照是数据库执行实验，包含更新/WAL工作，每次回滚；不是完整HTTP链路的优化收益。产品业务SQL、索引和耐久性设置尚未改动。

## 配置与完整链路结果

沿用隔离项目`air-perf-drain-split-20260927`的保留卷，开发栈持续运行。应用镜像`air-perf-plan-waits:local`，ID `sha256:0ce34bebaeb08f674ac9e9d9215dd0a6260aeeb8eb1269622f2fe04c54074430`。本轮代码仅在perf MARK日志增加驱动缓存的backend PID，读取不发送SQL。

- PostgreSQL18.6，fsync/synchronous_commit开启。原有历史outbox1,874,298条；冒烟新增60条浏览，正式轮使用未用过的文章1001–1100。
- 4个容器发压worker，混合浏览/点赞，目标1000 HTTP/s，300秒，并发200；HTTP16/文章后台4，总连接预算20；发布4×200、预算250ms，消费100/100ms。
- JDBC mark全量，HTTP10%抽样；独立连接/队列观察进程、PG5秒计数、JFR/GC；新增PG等待20ms采样、Linux约250ms目标采样、Windows WSL进程内存约1秒采样。
- PG实际计划阈值20ms，analyze/buffers/WAL开启，节点timing关闭，参数日志关闭。此配置仍给所有受观测SQL带来额外工作，参考[auto_explain说明](https://www.postgresql.org/docs/18/auto-explain.html)。正式轮用于归因，不与前几轮作吞吐收益比较。
- 登录5000用户在负载前完成；没有额外排除完整链路预热。共享WSL、历史增长、应用重启、诊断开销均限制跨轮比较。

| 指标 | 结果 |
| --- | ---: |
| 实际请求/有效写入 | 293,628 |
| 浏览/点赞 | 各146,814 |
| HTTP完成RPS | 978.3 |
| HTTP p95 / p99 | 162.8 / 332.6 ms |
| 计划请求漏发 | 2.124% |
| mark批数 / 满200批数 | 1,470 / 1,467 |
| outbox / Rabbit ready峰值 | 69,260 / 1,447 |
| HTTP后最后消费ACK | 48,250 ms |
| HTTP后管理探针确认排空 | 50,406 ms |
| 后台池最高active / pending | 2 / 0 |
| HTTP池最高pending | 160 |

事实、stats、outbox、processed逐范围核对通过，发布消费无失败/重试/重复，JDBC1470次prepare/execute/commit、借出/归还一致，实际更新293,628行；SQL/提交/关闭失败均为0。队列探针和PG区间探针无失败。

| 每批 ms | 均值 | p95 | p99 | 最大 |
| --- | ---: | ---: | ---: | ---: |
| 取连接 | 0.004 | 0.003 | 0.008 | 0.915 |
| UPDATE | 25.458 | 123.022 | 228.243 | 375.202 |
| commit | 9.812 | 15.404 | 40.807 | 321.673 |
| 完整mark | 35.774 | 148.588 | 250.214 | 433.307 |

各阶段分位数不能相加。全轮发布器claim均值69.236、send73.569、confirmWait5.224、mark35.774 ms/批：即使修好mark的异常计划，claim与发送仍需进一步核验，不能据此承诺整个链路已经能稳定跟上1000 RPS。

## 实际计划与统计变化

273个超过20ms的实际mark计划全部通过PID及execute起止时间唯一匹配，未匹配数0。其中270个选择`article_metric_outbox_pending_idx`，3个选择主键bitmap路径。计划导出仅保留节点/索引名、估计与实际行数、缓冲/IO/WAL数字及是否含参数占位符；不导出SQL、业务ID或谓词内容。

270个待发布索引慢计划中，265个Filter保留`$n`占位符、5个替换为常量。[PostgreSQL PREPARE说明](https://www.postgresql.org/docs/18/sql-prepare.html)以此区分generic/custom计划；统计更新会触发重新规划。

最慢样本mark起点89.646秒：更新200行，扫描节点估计1行、实际200行，另过滤31,714行，节点shared-hit37,802、shared-read0；UPDATE375.202 ms中PG执行373.430 ms。20ms等待采样在这一execute跨度内19次均为active/no-wait。证据支持大量扫描/过滤与执行开销；active/no-wait本身不能排除宿主调度影响，不能当成精确CPU时间。

| mark起点区间 秒 | UPDATE均值 ms | commit均值 ms | 完整mark均值 ms | outbox最高样本 |
| --- | ---: | ---: | ---: | ---: |
| 30–40 | 73.482 | 8.075 | 82.116 | 8,342 |
| 50–60 | 120.961 | 18.477 | 140.543 | 15,289 |
| 70–80 | 209.233 | 8.955 | 218.644 | 25,912 |
| 80–90 | 238.071 | 8.263 | 246.906 | 31,849 |
| 90–100 | 8.694 | 10.377 | 19.572 | 33,777 |
| 100–110 | 7.644 | 8.470 | 16.568 | 34,265 |

负载前`published_at.null_frac=0`。约89.852秒发生outbox automatic analyze，最后一条被捕获的pending索引计划在90.021秒结束，UPDATE均值随后明显回落；后续捕获的3个慢mark为主键bitmap计划。本轮仅捕获超过20ms的计划，不能将所有未记录批次的索引选择直接补成主键。

全轮autoanalyze37→40、autovacuum16→17，最后统计null_frac=0.014833333。统计变化、重新规划与延迟回落相符，副本实验进一步证实统计状态与generic/custom选择会改变路径及执行时间。回落后outbox仍增长，后半段claim/send与调度预算需要独立处理。

## 固定逻辑快照的SQL对照

在隔离schema复制2,167,984条已发布历史记录，建立同样的主键及调度pending索引，先ANALYZE空pending状态，然后新增20,000条pending、固定200个UUID。关闭副本autovacuum以固定统计状态。每阶段5次预热、10次记录，每次UPDATE在子事务回滚；每阶段核验pending仍20,000、published仍2,167,984。

先用字面量SQL做A/B/B/A：现有索引约5.3–5.6 ms，加ID索引仍约5.3 ms且仍选调度索引。这个结果不能代表真实JDBC参数化的generic路径，因此补了200个UUID绑定参数的PREPARE/EXECUTE实验。

| 参数化实验阶段 | 统计/计划 | UPDATE均值 / p95 ms | 实际路径 |
| --- | --- | ---: | --- |
| G1 现有索引 | 陈旧/generic | 101.592 / 124.501 | 调度pending索引、过滤19,800条 |
| G2 增加pending-ID索引 | 陈旧/generic | 73.361 / 74.950 | 仍选调度pending索引 |
| G3 保留ID索引 | 陈旧/custom | 5.692 / 9.065 | 仍扫描调度pending索引 |
| G4 删除ID索引 | 陈旧/custom | 5.495 / 6.192 | 仍扫描调度pending索引 |
| G5 刷新统计、现有索引 | 新/generic | 1.913 / 2.351 | 调度与主键bitmap组合 |
| G6 增加pending-ID索引 | 新/generic | 1.327 / 2.027 | pending-ID索引 |

陈旧null_frac=0；刷新后0.0088。custom的规划均值约0.34–0.37 ms，增加的规划开销远小于本场景generic慢扫描。candidate索引在20,000条pending时647,168字节，但真实库索引体积、插入/标记时的维护/WAL成本尚未完整链路验证。

这是相同逻辑行状态，副本堆布局、缓存和回滚产生的死版本会随阶段变化；G1与G2的差异不能直接归功于索引，因为两者实际路径相同。generic/custom/刷新统计的SQL路径及数量级差异是主要证据；不将这些均值换算成产品HTTP提速倍数。两份副本均已删除，真实业务表数据未改动。

## commit、WAL与WSL同轴证据

PG等待观察从负载前持续至排空，负载与排空窗口共17,526个样本；实际间隔均值20.000、p95 23、p99 26、最大63 ms。只在同一backend PID、实际execute/commit跨度内匹配，并核对active状态、查询类型与query_start，排除空闲ClientRead和旧查询。

匹配的active COMMIT样本694次：WALWrite515、WalSync152、WalWrite8、WALInsert1、active/no-wait18。它们是采样次数，不是事件持续时间分位数。[PG等待事件说明](https://www.postgresql.org/docs/18/monitoring-stats.html)中，WalSync对应WAL持久化等待，WALWrite对应WAL写入锁等待。

| mark起点 秒 | commit ms | 同连接COMMIT等待采样 | JFR mark线程socket ms |
| --- | ---: | --- | ---: |
| 51.593 | 321.673 | WALWrite×3，WalSync×13 | 321.435 |
| 193.650 | 190.163 | WALWrite×9 | 189.910 |
| 245.462 | 222.842 | WALWrite×3，WalSync×8 | 222.659 |
| 340.268（排空期） | 293.037 | WALWrite×11，WalSync×4 | 292.866 |

9个≥80ms的commit均匹配到mark代理调用栈的JFR commit SocketRead，socket约占99.7%以上。JFR epoch与应用墙钟存在约十几至几十ms偏移，已按同一长socket的结束时间局部对齐核验GC重叠，选列尖峰未发现GC pause重叠；单调耗时作为主值，不能将未经校正的毫秒墙钟重叠直接当精确因果。

最长尖峰的对应Linux约291ms区间中：IO some/full压力6.444%/4.407%，VM块设备sdd读写完成平均131.060 ms，PG CPU约0.456核、cgroup无节流。另一排空尖峰对应块设备平均190.097 ms。结合PG/JFR，这支持WAL等待受到存储链路拥堵影响；VM设备由共享WSL承载，当前没有Windows物理盘ETW/单次fsync轨迹，不能断言具体硬盘或其他进程造成了尖峰。

全HTTP窗口Linux实际采样间隔均值292.414 ms，CPU busy均值63.373%，CPU some压力均值19.287%；PG cgroup CPU均值3.591核，节流为0。WSL working set最高约6.46 GiB，但VM MemAvailable最低约2.14 GiB，memory some压力均值0.067%，本轮证据不足以把内存容量作为这些尖峰的主要解释。Windows进程CPU字段不可读，已保留为空，不当作0；宿主CPU结论使用VM `/proc`，并非Windows全机CPU。

## 下一步具体改造

1. **仅对markPreparedStatement试验关闭server prepare。** 通过`PGStatement.setPrepareThreshold(0)`保留参数绑定、一次UPDATE与一次commit，避免这条语句切换generic路径；做真实JDBC重复执行、回滚、幂等与连接复用验证，再以同初始快照完整链路A/B。驱动支持语句级设置，0关闭server prepare，见[pgJDBC说明](https://jdbc.postgresql.org/documentation/server-prepare/)。这是下一轮候选，目前只验证了PG custom计划路径，尚未落入业务代码。
2. **增加pending-ID索引作为后续候选，并与统计策略一起验证。** 目标DDL为`CREATE INDEX ... ON article_metric_outbox(id) WHERE published_at IS NULL`。单独增加不能保证陈旧统计下选用；custom仍可能全pending扫描，积压更大时仍有扩展风险。需要测新增outbox插入/更新WAL、SQL尾延迟和claim路径。
3. **继续看claim与发送。** 本轮mark回落后仍积压；先利用已捕获的claim现场计划核对排序/扫描与预算，再拆send中的Rabbit/调度等待。维持耐久性开启，后台池pending=0，不优先扩大后台连接数。

## 验证、产物与状态

- Java62项通过、0跳过，真实PG验证backend PID为正；Node5项通过，包含泛型参数检测、谓词/ID过滤、完整多行计划解析及mark覆盖核验。日志`target/plan-waits-java-tests-2026-09-27.log`、`target/plan-waits-node-tests-2026-09-27.log`。
- 新增冒烟60浏览及正式293,628写入；含全部历史，最终views1,084,111、likes1,083,873，stats一致，outbox=processed=2,167,984，unpublished/wrongArticles/testSchemas均0。两个副本各60个实测批次全部恢复同一逻辑行计数；最终核验`target/plan-waits-final-validation-2026-09-27.json`。
- [计划/等待/慢批完整数据](plan-waits-2026-09-27.json)、[逐批](plan-waits-2026-09-27-batches.csv)、[实际计划](plan-waits-2026-09-27-plans.csv)、[Linux区间](plan-waits-2026-09-27-linux.csv)。
- [参数化副本实验](mark-prepared-benchmark-2026-09-27.json)、[逐次参数化实验](mark-prepared-benchmark-2026-09-27.csv)、[字面量实验](mark-plan-benchmark-2026-09-27.json)。
- [链路结果](plan-waits-chain-2026-09-27-detail.json)、[逐秒等待/队列](plan-waits-chain-2026-09-27-timeline.csv)、[PG/WAL区间](plan-waits-chain-2026-09-27-pg-intervals.csv)、[JFR汇总](plan-waits-chain-2026-09-27-spikes.json)。原始文件与编排在`target/plan-waits-*`及`target/mark-*-benchmark-*`。
- 隔离栈已停止，卷与记录保留，副本schema已清理。仅原开发栈四个容器运行。
