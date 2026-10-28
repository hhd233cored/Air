# 独立本机压测

在 `backend-spring` 目录执行。压测栈监听 `127.0.0.1:18081`，使用单独的 `air-perf` Compose 项目；不会读取开发库、Python SQLite 或仓库中的现有歌曲。需要 Docker Desktop、Node.js 24 和预先构建的 `backend-spring-app:latest` 镜像。

```powershell
# 首次运行：生成只保存在 target/ 中的压测凭据与空目录。
New-Item -ItemType Directory -Force target/perf-data/articles,target/perf-data/chatter,target/perf-data/music | Out-Null
'{"id":"local","title":"Perf playlist","tracks":[]}' | Set-Content target/perf-data/music/playlist.json -Encoding utf8
$keys = 'PERF_DB_PASSWORD','PERF_RABBIT_PASSWORD','PERF_ADMIN_PASSWORD','PERF_USER_PASSWORD'
$lines = foreach ($key in $keys) {
    $secret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
    "$key=$secret"
}
Set-Content target/perf.env $lines -Encoding ascii

docker compose -p air-perf --env-file target/perf.env -f perf/compose.yml up -d --wait
Get-Content perf/seed.sql -Raw | docker exec -i air-perf-postgres-1 psql -v ON_ERROR_STOP=1 -U air_perf -d air_perf

foreach ($line in Get-Content target/perf.env) {
    if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
}
$env:PERF_SCENARIO='smoke'
node perf/load.mjs
$env:PERF_SCENARIO='all'
node perf/load.mjs | Tee-Object target/perf-results.jsonl
```

`PERF_STAGE_SECONDS` 默认 30。`PERF_SCENARIO` 可用 `smoke`、`all`、`read-ceiling`、`search-ceiling`、`search-refine`、`search-repeat160`、`search-high`、`mixed-soak`；`mixed-soak` 默认持续 180 秒，可用 `PERF_SOAK_SECONDS` 调整。脚本只允许本机 URL；默认请求 `http://127.0.0.1:18081`。阶段结果为每行一个 JSON 对象，可直接对照 [本次记录](RESULTS-2026-09-25.md)。

`all` 会创建虚构评论、上传虚构 WAV，并验证默认限流。重新运行完整测试前，建议重置压测栈以清空限流状态、队列和旧测试数据。停止并删除**仅属于 `air-perf` 项目**的容器与卷：

```powershell
docker compose -p air-perf --env-file target/perf.env -f perf/compose.yml down -v
```

`target/perf.env` 含本机测试凭据，始终留在 Git 忽略目录；不要把它复制到报告中。读取和搜索测试使用同一台主机发压，结果用于学习和比较，不能直接推算线上容量。

搜索 SQL 优化后的相同脚本复测与执行计划见 [搜索 SQL 优化对照](RESULTS-SEARCH-2026-09-25.md)。

评估 Redis 搜索缓存前，可在隔离栈运行 `node perf/search-distribution.mjs | Tee-Object target/perf-search-distribution.jsonl`；默认测试 400 RPS 的热门、混合和几乎全新关键词，以及 600 RPS 混合关键词，每档 45 秒。用 `PERF_SEARCH_RPS` 与 `PERF_STAGE_SECONDS` 调整负载。测试脚本只读搜索接口，同时给出 30 秒 TTL 的理论命中上限；方法、数据和结论见 [关键词分布压测](RESULTS-SEARCH-DISTRIBUTION-2026-09-25.md)。

## 文章浏览与点赞：5000 个虚构账号

先按上文启动全新的 `air-perf` 栈并加载 `perf/seed.sql`。等待应用创建 `perf_user` 引导账号后，在 **`backend-spring` 目录**执行：

```powershell
Get-Content perf/seed-metric-users.sql -Raw | docker exec -i air-perf-postgres-1 psql -v ON_ERROR_STOP=1 -U air_perf -d air_perf
foreach ($line in Get-Content target/perf.env) {
    if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
}
$env:PERF_METRIC_USERS='5000'
$env:PERF_LOGIN_CONCURRENCY='4'
$env:PERF_BURST_CONCURRENCY='250'
$env:PERF_PAUSE_BEFORE_DRAIN_SECONDS='30'
node perf/article-metrics.mjs | Tee-Object target/perf-metrics-5000.jsonl
```

脚本先登录 5000 个账号，再让最多 250 个账号同时执行各一次浏览和点赞；同一个账号额外提交 100 次点赞。登录准备时间与文章接口耗时分别统计。脚本在 `pause-before-drain` 后暂停 30 秒，可在独立终端运行 `docker restart air-perf-app-1` 观察未完成事件的恢复。`PERF_PAUSE_BEFORE_DRAIN_SECONDS=0` 可跳过暂停。登录会使用 Argon2 和 Redis Session；本机内存较小时不要提高登录并发。这个压测是 **5000 个用户事件、最多 250 个客户端并发用户**，并非 5000 条同时打开的 TCP 连接。压测结果见 [文章指标压测记录](RESULTS-ARTICLE-METRICS-2026-09-25.md)。

若要重新执行，先停止并删除仅属于 `air-perf` 的栈及卷，再按上文重建空栈、加载种子。不要清空日常开发数据库。

要观察写接口内部耗时，在**启动隔离栈之前**向 `target/perf.env` 增加 `PERF_TIMING_ENABLED=true`，并确保应用镜像由当前源码构建；运行脚本时设置 `$env:PERF_TIMING='1'`。只有两端都开启时，指标写接口才返回 `Server-Timing` 响应头，脚本会汇总参数校验、文章查询、事实 INSERT、outbox INSERT、近似 COMMIT、事务与控制器调用段的平均值和分位数。产品默认关闭该开关。完整 HTTP 与控制器调用段之差仍包含认证、Session、CSRF、Redis、序列化、网络与排队，不能按其中任一项命名。500 并发对照和阶段结果见 [500 并发压测记录](RESULTS-ARTICLE-METRICS-500-2026-09-25.md)。

### 按业务结果比较，并采样等待状态

`perf/article-metrics-compare.mjs` 使用同一 Node `fetch` 客户端和固定并发数，分别报告 HTTP 状态与业务结果。为避免修改开发栈，先构建专用镜像，并只启动 `air-perf` 项目：

```powershell
docker build -t air-perf-bench:local .
Add-Content target/perf.env 'PERF_APP_IMAGE=air-perf-bench:local'
Add-Content target/perf.env 'PERF_TIMING_ENABLED=true'
Add-Content target/perf.env 'PERF_RATE_LIMIT_ENABLED=false'
docker compose -p air-perf --env-file target/perf.env -f perf/compose.yml up -d --wait
```

先加载上面的 `perf/seed.sql` 和 `perf/seed-metric-users.sql`，再将 `target/perf.env` 中的 `PERF_USER_PASSWORD` 导入当前进程环境。每个有效写场景从**全新** `air-perf` 数据卷开始；不要对开发栈运行种子或清库命令。

```powershell
$env:PERF_TIMING='1'
$env:PERF_BURST_CONCURRENCY='100'
$env:PERF_COMPARE_REQUESTS='10000'
$env:PERF_COMPARE_SCENARIO='mixed'          # 5000 个用户，各一次有效浏览和点赞
node perf/article-metrics-compare.mjs | Tee-Object target/compare-mixed.jsonl

# 其他场景先重建空的 air-perf 卷，再重新加载两份种子。
$env:PERF_COMPARE_SCENARIO='duplicate-like' # 一个账号预热点赞，10000 次重复点赞
node perf/article-metrics-compare.mjs | Tee-Object target/compare-duplicate.jsonl

$env:PERF_COMPARE_SCENARIO='anonymous-view' # 一个匿名 CSRF Session，10000 个不同浏览事件
node perf/article-metrics-compare.mjs | Tee-Object target/compare-anonymous.jsonl
```

`comparison-result` 的 RPS 只覆盖突发请求，登录和 CSRF 准备另以 `comparison-ready` 报告。`changed`、`unchanged` 分开计数；`wait-sample` 在上次采样结束至少 200 ms 后记录 Hikari 活跃/空闲/待连接线程、PostgreSQL 活跃连接、Lock/IO 等等待数与活动等待事件名，以及采样查询的耗时。探针和业务请求共用应用连接池；当连接池饱和时探针可能延迟，因此这是抽样，不是精确峰值。`preController` 从最早的 Servlet 过滤器到控制器入口，包括 Security、Session、CSRF 和过滤器内等待；仍不含连接进入 Servlet 之前的排队。客户端耗时减去 `preController + controller` 也还包含网络、客户端调度与响应写出，不能单独命名为某一组件的耗时。探针仅在 `PERF_TIMING_ENABLED=true` 时注册，并沿用正常登录鉴权。

若另外在**隔离的 Redis 与进程**中运行所给秒杀项目，可用同一个客户端统计其 HTTP 与业务结果：

```powershell
$env:PERF_COMPARE_SCENARIO='spike'
$env:PERF_TIMING='0'
node perf/article-metrics-compare.mjs | Tee-Object target/compare-spike.jsonl
```

秒杀项目硬编码连接本机 Redis `:6379`，脚本只连接本机 `:3005`；运行前须确认这两个端口指向隔离环境。该场景区分 `accepted` 和 `sold-out`，不要把 HTTP 200 全算成成功购票。三个 Air 场景和秒杀项目的功能与持久性承诺不同，数字只用于比较有效写和快速返回的量级。

本机同客户端试跑的数据与限制见 [文章指标和秒杀对照记录](RESULTS-ARTICLE-METRICS-COMPARE-2026-09-25.md)。

公开文章 slug 查询的保语义索引改动、执行计划和重复点赞 A/B 数据见 [slug 索引验证](RESULTS-ARTICLE-SLUG-INDEX-2026-09-26.md)。

加索引后有效浏览与首次点赞的独立栈复测、连接池等待和异步收敛数据见 [有效写复测](RESULTS-ARTICLE-METRICS-RETEST-2026-09-26.md)。

要在同一时间轴记录取数据库连接耗时、待发布 outbox 与 RabbitMQ 队列深度，使用 `perf/compose-observe.yml` 给隔离 RabbitMQ 的管理 API 增加本机端口映射，并在脚本中设置 `PERF_TIMELINE=1`、`PERF_TIMING=1`、`PERF_RABBIT_MANAGEMENT_URL=http://127.0.0.1:18083` 与隔离栈的 `PERF_RABBIT_PASSWORD`。采样覆盖突发和异步排空；数据与分析见 [连接与积压时间轴](RESULTS-ARTICLE-METRICS-TIMELINE-2026-09-26.md)。

### 拆测 outbox 发布器

当前镜像在 `PERF_TIMING_ENABLED=true` 时还会输出 `PERF_ARTICLE_PUBLISHER` 非空批次计时：领取、发送、实际确认等待、异步确认延迟、标记，以及领取和标记内的 Hikari 借连接耗时。批量标记版本额外输出 `markMode=batch`、`markRequested`、`markCalls` 和 `markBatch`；`markBatch` 的分位数表示数据库批量调用耗时，不能解释为单条事件延迟。汇总脚本同时支持此前的逐条标记记录，`markAmortizedPerEventMs` 仅表示总标记时间除以请求标记的事件数。异步确认延迟与其他阶段重叠，不应累加到串行耗时中。保持 `PERF_TIMELINE=1` 让客户端记录突发和排空的完整时间戳，等脚本结束后提取日志并汇总。以下示例对应拆测项目，运行自己的项目时替换容器名和结果文件名：

```powershell
docker logs air-perf-publisher-app-1 2>&1 |
    Select-String 'PERF_ARTICLE_PUBLISHER ' |
    ForEach-Object {
        $line = $_.Line
        $marker = 'PERF_ARTICLE_PUBLISHER '
        $line.Substring($line.IndexOf($marker) + $marker.Length)
    } | Set-Content target/publisher-batches-2026-09-26.jsonl -Encoding utf8

node perf/summarize-publisher.mjs target/publisher-batches-2026-09-26.jsonl `
    target/publisher-mixed-2026-09-26.jsonl target/publisher-anonymous-2026-09-26.jsonl |
    Tee-Object target/publisher-summary-2026-09-26.jsonl
```

汇总按批次开始时间区分突发或跨界批次与请求结束后开始的批次；完整 200 条批次的 p95 是批次耗时分位数，不是全部单条事件的 p95。结果与下一步建议见 [发布器拆测](RESULTS-ARTICLE-METRICS-PUBLISHER-2026-09-26.md)。

当前发布器已改为确认成功集合的一次批量标记，可靠性测试和相同负载复测见 [批量标记实现与复测](RESULTS-ARTICLE-METRICS-BATCH-MARK-2026-09-26.md)。

### 逐条消费者拆测（历史基线）

此前的逐条消费镜像开启 `PERF_TIMING_ENABLED=true` 后，保存逐条消费样本，由定时任务以每行最多 100 条输出 `PERF_ARTICLE_CONSUMER`。样本包含 `eventMs`（含借连接和映射）、`applyCallMs`（完整事务代理调用）、`processedSqlMs`（防重 INSERT）、`statsSqlMs`（浏览计数或点赞重算 SQL）、`commitApproxMs`、`cacheMs`（Redis 删除调用）和 `ackMs`，并记录借连接、事务完成状态和缓存删除失败数。默认配置关闭采样与日志定时任务。

`applyBodyMs`、SQL、提交与借连接是 `applyCallMs` 的子段，不能重复相加。`commitApproxMs` 从 Spring `beforeCommit` 到 `afterCommit`，包含 JDBC COMMIT 和事务回调开销；回滚样本不混入成功提交的分位数。`cacheMs` 包含 Redis 客户端、连接与网络，不是纯 Redis 服务端执行时间。`cycleMs` 从监听方法入口到确认调用完成，不含此前的队列等待或分组日志输出。

等待客户端记录 `pipeline-drained` 后再提取日志，并核对汇总样本数与实际消费事件数；最后不足 100 条的样本也会由定时任务输出。以下示例对应新的消费者拆测项目：

```powershell
docker logs air-perf-consumer-app-1 2>&1 |
    Select-String 'PERF_ARTICLE_CONSUMER ' |
    ForEach-Object {
        $line = $_.Line
        $marker = 'PERF_ARTICLE_CONSUMER '
        $line.Substring($line.IndexOf($marker) + $marker.Length)
    } | Set-Content target/consumer-samples-2026-09-26.jsonl -Encoding utf8

node perf/summarize-consumer.mjs target/consumer-samples-2026-09-26.jsonl `
    target/consumer-mixed-2026-09-26.jsonl target/consumer-anonymous-2026-09-26.jsonl |
    Set-Content target/consumer-summary-2026-09-26.jsonl -Encoding utf8
```

汇总分别报告 VIEW、LIKE，并以消费开始时间区分突发或跨界消费和请求结束后才开始的消费。分位数直接从逐条样本计算。

本次分段结果、正确性核对及后续建议见 [消费者拆测记录](RESULTS-ARTICLE-METRICS-CONSUMER-2026-09-26.md)。

### 批量消费者

当前默认单消费者，最多 100 条一批，聚批最多等 100 ms。隔离 Compose 可用 `PERF_CONSUMER_BATCH_SIZE=50/100` 调节，设为 `1` 可保持同一实现做单条对照；`PERF_CONSUMER_BATCH_WAIT_MS` 控制聚批等待（1–1000 ms）。批量读取 outbox、批量插入防重标记，然后一条统计 UPSERT 更新所有受影响文章：VIEW 合并增量，LIKE 从真实关系重算，纯 VIEW 保留已有点赞数。事务提交后一次 Redis DEL 删除本批唯一文章键并逐条 ACK；数据库故障则有效消息全部 NACK/requeue。

计时日志仍是 `PERF_ARTICLE_CONSUMER`，但样本 `sampleKind=batch`，包含 `received/applied/duplicate/rejected/requeued`、`viewEvents/likeEvents/cacheArticles`。`cycleMs` 不含监听器入口之前的聚批和队列等待。每批一次事务，每批记录一组 SQL 与提交耗时；分位数为批次耗时，`amortizedMsPerReceivedMessage` 仅是累计耗时除以收到消息数，不能作为单条消息延迟。

批量统计/缓存版本增加 `statsSqlCalls/cacheDeleteCalls/cacheEvictionFailedArticles`。`cacheArticles` 仍是涉及文章数，不能当作 Redis 调用次数；`cacheEvictionFailures` 是失败调用数，批量调用失败影响多篇文章。历史缺失字段汇总为 null，不能当作零。批量 DEL 用于当前单机 Redis 配置。事务与缓存并非强一致，删除失败仍 ACK 已提交事件，并依靠短 TTL；此版本没有扩展消费者并发。

```powershell
docker logs air-perf-consumer-batch-app-1 2>&1 |
    Select-String 'PERF_ARTICLE_CONSUMER ' |
    ForEach-Object { $marker = 'PERF_ARTICLE_CONSUMER '; $_.Line.Substring($_.Line.IndexOf($marker) + $marker.Length) } |
    Set-Content target/consumer-batch-samples-2026-09-26.jsonl -Encoding utf8

node perf/summarize-consumer-batch.mjs target/consumer-batch-samples-2026-09-26.jsonl `
    target/consumer-batch-mixed-2026-09-26.jsonl target/consumer-batch-anonymous-2026-09-26.jsonl |
    Set-Content target/consumer-batch-summary-2026-09-26.jsonl -Encoding utf8
```

实现、可靠性验证与复测见 [批量消费记录](RESULTS-ARTICLE-METRICS-CONSUMER-BATCH-2026-09-26.md)。

### 连续发布与多文章对照

`PERF_PUBLISHER_MAX_BATCHES=1/4` 可在同一镜像上比较单批轮询与有界连续发布；`PERF_PUBLISHER_RUN_BUDGET_MS` 默认 250 ms，仅用于下一批准入。发布器默认仍为单批；满 200 条且全部成功才继续，短批、失败或达到上限时结束。本轮匿名 HTTP 未显示稳定收益，所以连续发布保留为可配置候选。

发布日志增加 prepare/payload/template/convert/properties/rabbitAfterConvert 和 Confirm 完成相对发送返回的间隔，并记录 turnId/batchIndex；`summarize-publisher.mjs` 区分轮内与轮间空档。`rabbitAfterConvertMs` 是客户端调用剩余段，不是纯 broker 执行时间；新嵌套字段不能与 sendMs 再相加。

`PERF_ARTICLE_COUNT=100`、`PERF_ARTICLE_OFFSET=1` 可把负载 round-robin 到 100 篇文章；每个用户的浏览和点赞落在同一篇文章。客户端逐篇等待计数，输出各文章 HTTP 延迟与完成时间摘要。下一轮用 offset=101、201 等未用过的范围，保留以前的数据。默认仍测一篇文章。

[run-metric-experiment.ps1](run-metric-experiment.ps1) 负责启动独立项目、运行负载、提取日志、汇总、逐篇核对和可选停止。Project 必须以 `air-perf-drain-` 开头，Label 拒绝覆盖已有文件，Seed 拒绝已有夹具的数据库。请求数默认 10000，可用 `-Requests 1 -Scenario anonymous-view` 验证稀疏消息。日志均在 ignored 的 target；脚本不会删除卷或清空旧数据。

`-Image air-perf-consumer-bulk:local` 可选择当前优化镜像；省略时沿用原发布器对照镜像。每轮配置记录实际镜像 ID，便于在相同参数下交替比较实现。

先准备上文的 `target/perf.env` 和夹具目录；新环境使用 `docker build -t air-perf-publisher-drain:local .` 构建当前源码。本机保留的历史测量镜像无需重建，重新构建会改变镜像 ID。

```powershell
./perf/run-metric-experiment.ps1 -Project air-perf-drain-example-20260926 `
  -Label spread-example-b50 -AppPort 18131 -RabbitPort 18132 `
  -PublisherBatches 4 -ConsumerBatchSize 50 -ArticleCount 100 -ArticleOffset 1 -Seed

node perf/summarize-metric-experiments.mjs target/spread-example-b50
```

实验设计、结果、确认延迟口径和限制见 [发送拆测与多文章对照](RESULTS-ARTICLE-METRICS-PUBLISHER-DRAIN-2026-09-26.md)。

后续一条统计 UPSERT 与一次 Redis DEL 的实现、45 项回归及旧/新镜像交替对照见 [批量统计与缓存记录](RESULTS-ARTICLE-METRICS-CONSUMER-BULK-2026-09-26.md)。

### HTTP JDBC 详细计时

使用 `-Image air-perf-http-jdbc:local -JdbcTiming` 开启连接持有、SQL execute、ResultSet 读取与直接 commit/rollback/close 计时。它需要原 perf timing 同时开启；`AIRCHORD_PERF_JDBC_ENABLED` 默认 false，Compose 对应 `PERF_JDBC_TIMING_ENABLED`。仅带 `X-Perf-Timing: 1` 的文章浏览/点赞写请求记录，未计时请求直接使用原连接。计时不记录 SQL 文本或绑定参数。

Server-Timing 增加 dbHold*、jdbcPrepare、jdbcExecute 及按账号/文章/事实/outbox 分项、jdbcRead、jdbcCommit、jdbcRollback、dbClose 和 dbHoldOtherWork；X-Perf-Db-Counts 提供借出/归还、SQL/提交/回滚与失败数。jdbcExecute 包含驱动/网络/数据库执行，不能作为纯服务端 CPU 时间；直接 commit 和原 commitApprox 含义不同，持有时间已包含 SQL/提交。

`node perf/summarize-http-jdbc.mjs target/label [...]` 输出详细汇总及与等待探针对齐的时间轴；按请求完成时刻分秒桶，不是 SQL 精确发生区间。历史无详细计时的组显示 jdbcSamples=0、相关汇总为空，不视为零耗时。脚本开启详细计时时核对抽样覆盖与借出/归还；默认 sample rate=1 时仍要求全量。

实现、51 项回归、详细计时开/关校验及匿名对照见 [HTTP JDBC 拆测](RESULTS-ARTICLE-METRICS-HTTP-JDBC-2026-09-26.md)。

### 随机抽样与 PostgreSQL 18 WAL/IO

`-JdbcTiming -JdbcSampleRate 0.1` 对带压测标记的写请求随机选取 10% 记录 JDBC 细节；基础 Server-Timing 保持全量。配置为 `AIRCHORD_PERF_JDBC_SAMPLE_RATE`（默认 1.0），Compose 对应 `PERF_JDBC_SAMPLE_RATE`。详细阶段的均值和分位数按抽中的请求计算，连接占用在抽样时是推算值，汇总的 `occupancyEstimated` 标识此口径。

`-PostgresCounters` 应用于新建的隔离项目：额外加载 `compose-pg-io.yml`，开启 PostgreSQL 18 的 IO/WAL timing 和 pg_stat_statements，并创建扩展。保持 fsync、synchronous_commit 开启。不要用此覆盖文件重建开发栈。只在 perf timing 与 `AIRCHORD_PERF_PG_ENABLED=true` 同时开启时提供受登录保护的累计计数探针，不重置统计、不返回 SQL 文本。

客户端在登录准备完成后等待 1.5 秒取基线，在 HTTP 结束和队列排空后再次取快照；排空快照额外等待 1.5 秒以减少统计刷新滞后。窗口包括 HTTP、发布器、消费者、探针和数据库后台活动。`pg_stat_io` WAL 写/同步次数不是每个请求的次数，不能用 WAL 总耗时直接除以请求数作为 commit 延迟。预备 COMMIT 在本环境的 pg_stat_statements 覆盖不完整，其 utility 均值不能代表持久化提交。

```powershell
./perf/run-metric-experiment.ps1 -Project air-perf-drain-pgio-example `
  -Label pgio-example -AppPort 18251 -RabbitPort 18252 `
  -Image air-perf-pg-io:local -ArticleCount 100 -ArticleOffset 1 `
  -JdbcTiming -JdbcSampleRate 0.1 -PostgresCounters -Seed -StopStack
node perf/summarize-postgres-io.mjs target/pgio-example
node perf/summarize-http-jdbc.mjs target/pgio-example
```

使用当前源码构建示例镜像：`docker build -t air-perf-pg-io:local .`。复用实验项目时使用未测试过的文章范围和新 Label，省略 Seed。运行结束保留卷及原始结果。

六轮复测、54 项回归、WAL/IO 结果与未拆清的 HTTP 时间见 [随机抽样与 WAL/IO 实验记录](RESULTS-ARTICLE-METRICS-WAL-IO-2026-09-26.md)。

### 连接池与 HTTP 入口 / 客户端对照

`-PoolSize 10` 或 `-PoolSize 20` 只修改隔离压测 Compose 的 Hikari maximum/minimum-idle；预检从应用读取真实参数并核对。产品配置保持不变。各组保持相同镜像、10% JDBC 抽样、WAL/IO 采集、消费者与发布器配置。

`-HttpTransportTiming` 使用 Node 内置 Undici diagnostics channel，记录调用→创建请求→写请求头→bodySent→收到响应头→fetch resolve→text 读完。前三段包含客户端创建/调度/连接等待；response headers 表示完整响应头被解析，不是精确首字节。`clientBodyWire` 与 headersDelivery/bodyConsume 有重叠，不能再相加。所有计时使用同一客户端单调时钟，每个并发请求独立关联，不记录 Cookie 或正文。

服务端 perf 开启时添加 Tomcat Valve，把 Coyote 的请求解析起点传给最早 filter，Server-Timing 增加 `tomcatPreFilter`。该段覆盖解析起点到 filter，排除起点前的 accept/poller/executor 等等待；不能视为全部服务端排队。等待探针还返回 Tomcat active/maximum/queued 工作线程采样。`clientAwaitHeaders - tomcatPreFilter - preController - controller` 为仍未拆清的余量，包含前述更早等待、网络/容器转发与响应准备；它不是纯网络延迟。

客户端记录 burst 内事件循环利用率、延迟和 CPU 时间；这些与数据库同步指标一起判断同机压测扰动。客户端全量阶段和 Tomcat 计时覆盖不足会使实验失败。时间轴仍按请求完成秒分桶。

`-ClientLocation container` 使用同版本 `node:24.15.0-alpine`，只连接该实验项目 Docker 网络内固定 `app:8081` / `rabbitmq:15672`，并只读挂载 perf 脚本。需预先准备该镜像，配置记录其实际 ID。凭据通过进程环境传入，不写入命令输出。默认 host 仍只允许本机回环地址。容器客户端同时改变客户端操作系统和网络访问路径，结果不能单独归因于其中一项。

```powershell
./perf/run-metric-experiment.ps1 -Project air-perf-drain-pool-example `
  -Label pool-example -AppPort 18281 -RabbitPort 18282 `
  -Image air-perf-pool-http:local -PoolSize 20 -HttpTransportTiming `
  -JdbcTiming -JdbcSampleRate 0.1 -PostgresCounters `
  -ArticleCount 100 -ArticleOffset 1 -Seed -StopStack
```

十二轮对照、连接池收益、客户端路径结果和正确性核对见 [连接池与 HTTP 路径实验记录](RESULTS-ARTICLE-METRICS-POOL-HTTP-2026-09-26.md)。

### 完整链路汇总

`node perf/summarize-fullchain.mjs target/label [...]` 在完整实验结束后合并 HTTP/JDBC、PG、发布与消费者日志，核对有效写入、Confirm/mark/apply、事务/缓存调用、队列和逐篇计数。输出 `fullchain-summary/fullchain-timeline/fullchain-group` JSONL；同参数重复按场景合并吞吐，不平均分位数。时间轴按请求/批次完成时间分秒归桶，缺失探针保留空值。

全批完成吞吐用事件数除以 burst 起点到最后消费者完成日志的时间，包含异步尾部；该日志在提交、Redis 失效和 ACK 调用返回后产生，不能据此得到逐事件端到端 p95。`fullchain-event-lag.sql` 可只读统计指定夹具范围的创建→标记发布/消费事务起点滞后（psql 变量 article_start/article_end）；now() 是事务起点，不能视为提交或 ACK 时间。

四轮 4 万写入的当前默认处理参数复测、完整阶段统计及 CSV 见 [完整链路压测记录](RESULTS-ARTICLE-METRICS-FULLCHAIN-2026-09-26.md)。

### 持续到达负载

`run-metric-experiment.ps1 -DurationSeconds 60 -TargetRps 600 -Concurrency 200` 按时长准入，不受短测 10,000 请求上限限制；支持最长 600 秒。匿名按请求发起；混合按每单位“浏览后点赞”发起，目标单位速率为 RPS/2，要求偶数 RPS。混合登录 5,000 个账号，跨轮次轮换文章，每个用户/文章组合仅点赞一次，超过唯一组合容量直接拒绝。每次浏览用新幂等键，最终核对所有已发送请求 changed、逐篇事实/统计与 outbox/processed。

发压并发有上限；没有可用槽位的到达记录 droppedBusy，超过 25 ms 调度预算的旧到达记录 droppedLate，避免无限追赶造成突发。`sustained-load` 和逐秒 `sustained-arrival-second` 分开记录计划、已发送和未发送请求；未发送不算 HTTP 成功，也不能算服务器业务错误。明显未达目标时，不能据此宣称服务器支持该目标速率。混合的并发上限是串行请求对数量，其瞬时 HTTP 请求数也不会超过该上限。

完整 HTTP 计时包含最后在途请求完成；`sustained-steady-window` 按完成时间统计第 10 秒至准入结束的请求，仍同时报告整轮尾延迟和最终消费完成时间。新参数仅用于隔离压测，保持产品默认配置与耐久性不变。

`summarize-fullchain.mjs` 默认要求所有等待和队列探针成功。对于需保留真实采样失败的实验，显式添加 `--allow-probe-gaps`，业务、最终队列与计时覆盖门槛继续校验，输出 `PASS_WITH_PROBE_GAPS` 并保留失败记录与次数；缺测不补零。`export-factor-sustain.mjs summary.jsonl output-prefix` 读取完整汇总及同前缀事件滞后文件，导出逐轮/逐秒 CSV 与完整 JSON。

16 轮参数对照与六轮持续负载、候选参数和实际到达量见 [四组参数与持续负载记录](RESULTS-ARTICLE-METRICS-FACTOR-SUSTAIN-2026-09-26.md)。

### 独立采样进程与 JVM 尖峰观测

`-ObserverProcess` 将等待/RabbitMQ采样移到独立 Node 子进程，用私有 IPC 传递探针会话；记录发压/采样 PID，采样约 500 ms 一次，PostgreSQL 累计计数约 5 秒一次。采样失败保留缺测，drain 要求负载结束后连续两次全链路为空。Host 和容器客户端均支持；`-ClientLocation container` 改变客户端操作系统及访问路径，仍共用主机硬件。

`-JvmProfile -StopStack` 使用 `compose-jfr.yml` 开启 JFR profile、GC/safepoint 日志，停栈后收集 `target/label.jfr` 和 `label-gc.log`。JFR 从应用启动开始，分析时按 burst 的墙钟边界筛选；配置 `article-safe.jfc` 禁用环境变量、系统属性和进程命令事件。JFR 有测量开销，对照组应全部使用相同观测配置。

`collect-jvm-profile.ps1 -Label label` 用 JRE 内置 `jfr summary` 验证禁用事件计数为零，再用本机 JDK 21 运行 `JfrCompact.java`，逐事件读取 GC、CPU、park/monitor/socket；省略非 Hikari 的 idle park，只输出时间、选定指标和方法栈，不将完整嵌套 JSON 载入内存。转换安排在轮次之间。`summarize-spikes.mjs fullchain.jsonl output-prefix` 合并逐秒 GC 暂停、Hikari park、commit socket、Tomcat 队列和 SQL commit，以及 PG 计数区间。并行线程等待为累计线程时间，不能直接相加为请求延迟或服务器停顿；同秒相关不等于因果。

```powershell
./perf/run-metric-experiment.ps1 -Project air-perf-drain-long-example-new `
  -Label long-example-new -AppPort 18601 -RabbitPort 18602 `
  -Image air-perf-pool-http:local -PoolSize 20 -PublisherBatches 4 `
  -Scenario mixed -ArticleCount 100 -ArticleOffset 1 `
  -DurationSeconds 300 -TargetRps 1000 -Concurrency 200 -ClientLocation container `
  -ObserverProcess -JvmProfile -JdbcTiming -JdbcSampleRate 0.1 `
  -PostgresCounters -HttpTransportTiming -Seed -StopStack
./perf/collect-jvm-profile.ps1 -Label long-example-new
```

六轮20/4候选验证、Host/Container对照、两轮5分钟持续负载，以及GC/连接等待/commit/checkpoint同轴分析见[独立进程与长测记录](RESULTS-ARTICLE-METRICS-OBSERVER-LONG-2026-09-27.md)。`-PostgresCounters`保存数据库日志；`summarize-spikes.mjs`同时输出HTTP线程commit socket、账号/文章SQL和checkpointer实际IO区间，checkpoint完成计数为零时仍可核对其进行中的活动。

### 多进程发压与固定总预算的连接池隔离

`-LoadWorkers 4`用于持续负载：总目标单位速率和并发必须能被4整除。四个Node进程按共同墙钟起点、交错phase准入，混合请求按全局index分配，避免用户/文章组合重复。会话通过私有IPC传递；完整请求计时在负载结束后回传，由协调进程合并HTTP分位数和逐秒计数。worker CPU时间求和，事件循环利用率取均值；事件循环p99保留每进程值，并单独标注最大worker p99，不能当作全局分位数。并发最高值求和只是上界；每worker静态预算不可实时互借。

`-PoolSize 20 -BackgroundPoolSize 4`在perf模式下启用HTTP16/文章发布消费4；默认0使用统一池。两池总maximum仍为20，预检核对真实预算，探针新增`backgroundPool`的active/idle/pending。事实/outbox使用入口事务，后台processed/stats使用消费事务；作用域在事务前设置、失败后恢复，逻辑DataSource和Spring绑定连接保持一致。

主池也承接未进入文章后台作用域的定时任务。JFR汇总按HTTP线程、非HTTP线程及调用栈可识别的文章后台分别统计Hikari park；音乐导入发布器的非HTTP等待不能当成文章后台池等待。调用栈截断和事件阈值会限制JFR覆盖，探针的真实池active/pending与业务计时应一起解释。

```powershell
./perf/run-metric-experiment.ps1 -Project air-perf-drain-split-example-new `
  -Label split-example-new -AppPort 18701 -RabbitPort 18702 `
  -Image air-perf-split:local -PoolSize 20 -BackgroundPoolSize 4 `
  -LoadWorkers 4 -Scenario mixed -ArticleCount 100 -ArticleOffset 1 `
  -DurationSeconds 120 -TargetRps 1000 -Concurrency 200 -ClientLocation container `
  -ObserverProcess -JvmProfile -JdbcTiming -JdbcSampleRate 0.1 `
  -PostgresCounters -HttpTransportTiming -Seed -StopStack
```

本机可用`docker build -f perf/Dockerfile.split --target build -t air-perf-split-test:local .`与`--target runtime -t air-perf-split:local`复用上轮已准备的`air-perf-pool-http-test:local`、`air-perf-pool-http:local`依赖与JRE。其他环境使用项目Dockerfile从源码构建。实现、59项Java/11项Node验证和对照结果见[四进程与连接池隔离记录](RESULTS-ARTICLE-METRICS-WORKER-SPLIT-2026-09-27.md)。

## 批量标记 SQL 与提交计时

`-JdbcTiming`还会对文章发布器MARK阶段的所有批次采集真实JDBC prepare/executeUpdate/commit/close耗时、连接持有与调用/更新行数。HTTP的`-JdbcSampleRate`继续控制HTTP抽样，标记批次不抽样。日志`markJdbc`不含SQL文本、事件ID或绑定参数；`markStartedAtEpochMs`和execute/commit开始结束时间戳用于与outbox、PG/WAL时间轴关联。

```powershell
node perf/summarize-mark-jdbc.mjs target/实验label
```

新增汇总逐批核对一次借出/归还、一次SQL/commit、更新行数与实际写入总数，失败或缺测会拒绝结果。生成`-mark-jdbc.json`、`-mark-jdbc.csv`及10秒分段，不平均批次分位数。execute包含驱动/网络/数据库SQL执行与等待；commit也包含协议和数据库提交等待，不能直接将两列当作纯数据库CPU或纯磁盘时间。实现、回归与复测见[批量标记SQL/提交拆测记录](RESULTS-ARTICLE-METRICS-MARK-JDBC-2026-09-27.md)。

## 实际计划与同连接等待

`-PlanWaitDiagnostics`要求同时启用`-PostgresCounters -JvmProfile -StopStack`。只用于隔离栈：auto_explain记录≥20ms实际计划，节点timing关闭、参数日志关闭；PG等待目标20ms、Linux目标250ms、Windows WSL内存目标1秒采集，结束时停止观察作业，异常时停止隔离栈。原始文件位于忽略的target；公开计划通过显式字段名单移除SQL/谓词/业务ID，仅保留是否含参数占位符。

MARK日志还采集驱动缓存backend PID（不额外发送SQL），用于按同连接/阶段/active查询匹配。等待次数是采样值；idle ClientRead不算数据库提交等待，实际间隔和时钟偏移须核对。

```powershell
node perf/parse-auto-explain.mjs target/label-postgres.log target/label-plans.jsonl
node perf/summarize-plan-waits.mjs target/label perf/output-prefix
node perf/summarize-mark-plan-benchmark.mjs target/benchmark.jsonl perf/benchmark-prefix
```

`benchmark-mark-plans.sql`与`benchmark-mark-prepared.sql`只用于已排空的隔离库，复制outbox到专用schema、增加20,000个pending、固定200个ID，每阶段预热5次/实测10次、每次回滚恢复行状态；后者使用200个UUID参数比较generic/custom。成功时清理schema，异常时也需按编排finally清理本轮创建的schema。不能将副本SQL执行均值换算为完整HTTP提速倍数。采集、参数化计划差异和WAL尖峰证据见[实际计划与等待记录](RESULTS-ARTICLE-METRICS-PLAN-WAITS-2026-09-27.md)。

## 批量标记语句的 server prepare 对照

产品配置 `ARTICLE_METRIC_MARK_SERVER_PREPARE_DISABLED=true` 仅在批量标记 PreparedStatement 上设置 prepareThreshold=0；默认 false，保留驱动原策略。本轮 SQL 尾延迟改善，但整链路未稳定提速且出现队列近上限的恢复重试，候选先保留为显式开关。压测用 `-MarkServerPrepareDisabled $true/$false`，每批记录驱动实际 `serverPrepareThreshold`，不能只依据配置判断是否生效。

`copy-pg-snapshot.ps1` 从停止的隔离 PG 卷复制到新卷，保留原卷，用所有普通文件内容的聚合 SHA-256 验证副本。源卷必须没有运行容器，目标卷必须未存在；复制失败保留现场。`run-metric-experiment.ps1 -SnapshotPgVolume air-perf-markcustom-...` 使用该外部卷，从相同历史数据与统计开始。数据库启动后文件会变化，初始 seal 应在启动前比对。

Docker 地址池不足时可用 `-SnapshotNetwork air-perf-drain-markcustom-..._default` 复用已停止实验的网络，必须顺序运行，避免同名服务 DNS 别名冲突。各轮数据库、Redis、RabbitMQ 仍使用各自卷。此选项仅允许配合隔离快照。

每轮先执行完整链路与 mark JDBC 核验，再收集 JFR、公开计划和等待汇总。`summarize-fullchain.mjs` 按 prepare 配置分别分组；`summarize-markcustom.mjs` 核对四轮 A/B/B/A 的相同快照、镜像、关键参数和实际阈值，合并原始批次计算 SQL/commit 分位数，保留 HTTP 分位数的逐轮值。

完整链路汇总默认要求零发布失败。`--allow-publisher-retries` 仅允许逐批 claimed=sent、confirmed=markRequested=marked、failures=sent-confirmed，且最终 confirmed/marked/received/applied 全部等于有效写入；消费者重复/拒绝/重排、SQL/提交/缓存错误和最终队列非零仍拒绝。此模式将恢复重试的轮次显式标为 `PASS_WITH_PUBLISHER_RETRIES`，保留尝试数与失败数，不能写作零失败轮次。

```powershell
node perf/summarize-markcustom.mjs perf/markcustom-2026-09-27
```

实现、真实 PG 回归和四轮完整链路结果见[单语句 prepare 对照记录](RESULTS-ARTICLE-METRICS-MARK-CUSTOM-2026-09-27.md)。原始编排、manifest 和逐轮日志位于忽略的 `target/markcustom-*`。

## 消费者 stats SQL 实际计划与组件

`parse-auto-explain.mjs` 的第三个参数 `stats` 选择消费者 incoming/count/UPSERT SQL；默认仍选择mark。公开输出移除SQL、谓词、业务ID，保留冲突行数、子计划、heap fetch和可选节点计时。观察器新增 `stats` 查询分类；本次重用的旧观察日志仍按`other`，匹配时须核对计划区间、backend PID、active和query_start。

```powershell
node perf/parse-auto-explain.mjs target/label-postgres.log target/label-stats-plans.jsonl stats
node perf/summarize-stats-plans.mjs perf/stats-plans-2026-09-27 a1 b1 b2 a2
node perf/summarize-stats-components.mjs target/statsplan-benchmark-raw-2026-09-27.jsonl perf/stats-components-2026-09-27
```

第二条命令针对本次markcustom四轮历史记录，逐计划核对消费者批次并输出慢计划摘要/CSV；≥20ms计划与全批次客户端均值的样本范围不同。完整脱敏原始计划保留在target。第三条解析psql可能含换行的JSON文档，验证16组各10条实测，再输出组件数据。

`benchmark-stats-components.sql`只在**独立物理副本**运行：固定64篇、48篇刷新点赞，每条更新检查结果并子事务回滚；组件轮换预热5次/测10次，分别开关节点计时，随后只在副本VACUUM点赞表。`compose-stats-plan.yml`关闭副本autovacuum防止阶段漂移，不启动产品应用。异常也要清理本轮诊断schema、核对计数并停止副本；编排见target的setup/run-statsplan脚本。

预先给定计数和write-only为定位控制，不包含计数获得成本，也未验证在线并发语义。实际计划、回表/可见性差异、组件执行成本与长尖峰限制见[消费者 stats 计划拆测记录](RESULTS-ARTICLE-METRICS-STATS-PLANS-2026-09-27.md)。

