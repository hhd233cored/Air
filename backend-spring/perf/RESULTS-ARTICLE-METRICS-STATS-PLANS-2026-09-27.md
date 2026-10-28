# 消费者 stats SQL 实际计划与组件拆测

日期：2026-09-27。承接[单语句 prepare 完整链路对照](RESULTS-ARTICLE-METRICS-MARK-CUSTOM-2026-09-27.md)，本轮复用四轮完整链路已采集的计划、消费者、PG等待和JFR日志，再在独立物理副本测组件。没有新增HTTP持续压测，产品计数SQL和默认配置未改。

## 结论

1. **常规 stats SQL 的主要成本来自按文章重算点赞事实。** 四轮8,997个≥20ms实际计划中，点赞扫描占root缓冲命中的98.8%–99.1%，累计约4.04亿次heap fetch；已有`(article_id,user_id)`主键被使用，但`Index Only Scan`仍大量回表验证可见性。不能只依据计划名称判断为免回表读取。
2. **同副本组件验证：完整SQL38.174ms，count-only35.639ms，预先给定计数的UPSERT1.550ms。** 固定64篇、48篇刷新点赞、每篇约1,482条点赞，计时开启时count子树约占完整执行95.6%。条件回查约0.35ms，优先级较低。
3. **可见性是重要影响因素。** 副本VACUUM后heap fetch从每批71,147降为0，完整SQL降到11.437ms。仍需扫描约71,147条索引记录；离线VACUUM效果不能直接当成持续写入中的收益，也不能替代LIKE读模型的设计。
4. **少数长尖峰需要分开解释。** B1客户端stats SQL1009.174ms对应JFR读响应1004.733ms，却未捕获≥20ms对应计划，同时PG采样断档1021ms、Linux采样跨1273ms。没有该区间GC pause记录；现有证据不足以定位其具体调度/资源原因，不能将整秒等待归为点赞扫描CPU。

## 四轮实际计划与等待

`parse-auto-explain.mjs ... stats`按SQL结构识别stats语句。公开节点只保留结构、行数/loops、索引、buffer、heap fetch、WAL和诊断计时；移除原SQL、谓词和业务ID。默认mark解析行为保留。

每条计划核对到唯一消费者批次：PG计划结束时间在批次范围内，插入行数+冲突行数=批次涉及文章数，statsSqlCalls=1，服务端执行不超过客户端stats SQL计时（允许3ms边界）。8,997条均通过。

| 轮次 | 消费批次 | ≥20ms stats计划 | 客户端stats SQL均值 ms | 慢计划均值 ms | 点赞heap fetch总数 | 点赞缓冲hit占比 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 | 3,075 | 2,057 | 42.361 | 55.137 | 96,318,308 | 99.076% |
| B1 | 2,978 | 2,415 | 50.363 | 56.248 | 103,757,643 | 98.918% |
| B2 | 3,062 | 2,225 | 46.058 | 56.481 | 100,546,365 | 98.792% |
| A2 | 3,078 | 2,300 | 47.470 | 57.150 | 103,800,126 | 98.819% |

客户端均值含全部消费批次；服务端均值仅含≥20ms计划，两者样本范围不同。root/子树buffer计数是包含子节点的累计计数，没有逐层相加；点赞扫描叶节点与root比较。缓冲命中占比不等于耗时占比。

四轮慢计划的点赞扫描读盘block均为0；root少量read分别66/81/72/62。主要是缓存内重复扫描和MVCC可见性检查，当前证据不支持通过新增同前缀索引来消除这部分工作。

### A2最慢实际执行样本

- 客户端stats SQL339.438ms，PG执行335.610ms，更新71篇；点赞count子计划执行53次，约74,394条可见行，heap fetch74,409。
- root hit75,678，其中点赞扫描hit75,146，read0；同期匹配16个active/no-wait样本。
- 冲突更新中的incoming CTE查找执行71次，每次过滤70行，约5,041次行检查。它存在二次扫描成本，但组件计时显示当前量级远小于count。

### 等待匹配的范围

使用捕获的PG实际执行区间、同backend PID、active状态以及query_start与执行开始相差≤5ms核对；排除idle/旧查询。此前观察器把stats归为`other`，因此存在规划/区间边界误差，不能声称覆盖所有stats耗时。

匹配active/no-wait采样分别5,684/6,809/6,319/6,579次；其他采样主要为极少量BufferMapping/BufferContent/XactSLRU，以及B1/B2各1个ClientRead。无事件表示未报告数据库等待，仍可能被操作系统暂缓调度，不等同于纯CPU时间。新观察SQL已增加`stats`分类，供后续新轮次使用；没有改写既有采样。

## 独立副本组件实验

### 初始状态和方法

- 来源是**A2结束并核验后的物理库**，不是四轮开始前的空目标范围快照。源卷保持停止，只读复制到`air-perf-markcustom-statsplan-20260927`；源/目标普通文件聚合SHA-256一致：`39bc9eab56e0f469bb3b9c07504a0bd171d776cd2e167a76cd77abad30b391ac`。
- 只启动副本PG，autovacuum在该诊断实例中关闭，以免组件阶段的可见性状态被后台任务改变。原开发库和历史实验库的autovacuum配置未调整。
- 固定1201–1264号文章64行，48行refresh_likes=true，view_delta均为1。共94,860条点赞，单篇1,475–1,487条，初始事实=统计。
- 四种SQL交替并轮换顺序，避免固定顺序偏差；每种先预热5次，再测10次。TIMING OFF用于主要执行均值，TIMING ON用于子树定位；VACUUM前后各一组，共16组、160条实测和80条预热。
- 每条写SQL核对临时结果：view增加64、likes与原事实一致；随后用子事务回滚，逐次核对views/likes/updated_at恢复。所有240次检查通过。没有提交计数变化，执行均值不包含JDBC、提交、Redis或ACK。

### SQL控制的含义

| 控制 | 包含的工作 |
| --- | --- |
| full | 原stats计数SQL的同结构字面量版本：count、排序、UPSERT、incoming条件回查 |
| count-only | 同64行MATERIALIZED incoming，只执行输入SELECT、条件count和排序 |
| precount-upsert | 计数在测量前固定；保留UPSERT和incoming条件回查 |
| write-only | 计数在测量前固定；保留排序与同64行UPSERT，省去条件回查 |

预先给定计数是**诊断控制**，不包含获得计数的成本；write-only只在本次无并发且统计=事实的固定快照中保证等价，不能直接替换产品SQL。组件没有模拟实时LIKE/UNLIKE交错、消息乱序和并发更新，也没有复现JDBC参数计划缓存。各控制均值不能简单相减当作精确独立成本。

### 结果

每格为10次TIMING OFF服务端执行均值，单位ms。

| 状态 | full | count-only | precount-upsert | write-only | full每批点赞heap fetch |
| --- | ---: | ---: | ---: | ---: | ---: |
| VACUUM前 | 38.174 | 35.639 | 1.550 | 1.187 | 71,147 |
| VACUUM后 | 11.437 | 9.066 | 1.533 | 1.062 | 0 |

TIMING ON下，VACUUM前full43.184ms，其中count子树41.280ms、条件回查0.346ms；VACUUM后full15.446ms，count子树13.766ms、回查0.333ms。节点计时增加开销，尤其在更快的Index Only Scan中比例更明显，因此使用OFF结果评价整体SQL，ON结果只定位子树。

VACUUM前relallvisible/relpages为8,818/10,116（页数为统计估计）；后为10,246/10,246。没有ANALYZE，last_autoanalyze未变，业务行计数未变；VACUUM也会更新存储估计/清理版本，不能将全部差异严格分解为visibility map单一效果。即使heap fetch归零，count仍扫描71,147条索引记录；随点赞总量增加的扫描成本仍存在。

## 长尖峰单列

B1一次批次开始08:49:36.128 UTC、结束08:49:37.283，statsSqlMs1009.174、commit92.427。消费者同线程JFR依次记录processed查询约30.269ms、stats UPDATE读响应1004.733ms、commit读响应91.575ms；无该区间GC pause或消费者JavaMonitorEnter记录。

PG等待采样从08:49:36.163到08:49:37.184出现1021ms间隔，覆盖stats等待；Linux观察跨1273ms，该区间CPU some压力约38%、IO some/full约8.45%/4.96%。缺少中间数据，无法可靠归因具体资源或把该尖峰分摊到count/锁/规划。它需要后续针对调度、计划前阶段与协议等待的独立证据。

## 下一步选择

1. **优先设计LIKE幂等增量读模型，先验证语义。** 目前每批count读取的是当前完整事实，可能已经包含尚未消费的事件。改为消费delta之前，需要确认现有投影切换基线，防止把已经被count包含的增量再加一次；处理UNLIKE早于LIKE到达、重复投递、重试、初始缺行、批量混合VIEW/LIKE与并发更新。现有like_count>=0约束必须保留，不能直接删掉count后机械累加。
2. **将autovacuum/可见性参数作为低侵入候选验证。** 新插入页尚未all-visible是本场景的重要成本，但持续写入会继续影响可见性。应做同快照持续负载对照，同时记录heap fetch、vacuum资源、WAL和HTTP/异步滞后，再决定表级参数；本轮只证明离线副本效果。
3. **条件回查暂缓。** 约0.35ms的收益不足以优先引入额外SQL或影响纯VIEW保留点赞数的逻辑。先解决count主成本，之后再验证小幅整理是否值得。

## 验证与产物

- Node10项通过，包括新的stats解析/敏感字段移除回归及既有mark、发压、观察器测试；无产品Java代码变更，本轮未新增Java或HTTP压测。日志`target/statsplan-final-node-tests-2026-09-27.log`。
- [四轮计划摘要和代表计划](stats-plans-2026-09-27.json)、[全部逐计划指标](stats-plans-2026-09-27.csv)、[组件结果与安全计划](stats-components-2026-09-27.json)、[160次组件CSV](stats-components-2026-09-27.csv)。完整脱敏计划位于`target/statsplan-{a1,b1,b2,a2}-plans-2026-09-27.jsonl`。
- 原始组件JSON、源/目标hash、计数和异常尖峰核验位于`target/statsplan-*`。副本最终views=statsViews=1,232,330、likes=statsLikes=1,232,092，outbox=processed=2,464,422，pending=0；与实验前一致，64篇目标updated_at也全部恢复。
- 诊断schema已删除，副本/助手已停止，原开发栈四个容器正常运行，数据卷与实验记录保留。
