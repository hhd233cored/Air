param(
    [Parameter(Mandatory)][ValidateLength(1,63)][ValidatePattern('^air-perf-drain-[a-z0-9]+(-[a-z0-9]+)*$')][string]$Project,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9-]+$')][string]$Label,
    [Parameter(Mandatory)][ValidateRange(18000,19000)][int]$AppPort,
    [Parameter(Mandatory)][ValidateRange(18000,19000)][int]$RabbitPort,
    [ValidateSet('mixed','anonymous-view')][string]$Scenario = 'mixed',
    [ValidateRange(1,10)][int]$PublisherBatches = 4,
    [ValidateSet(50,100)][int]$ConsumerBatchSize = 100,
    [ValidateRange(1,2000)][int]$ArticleCount = 1,
    [ValidateRange(1,2000)][int]$ArticleOffset = 1,
    [ValidateRange(1,10000)][int]$Requests = 10000,
    [ValidateRange(0,600)][int]$DurationSeconds = 0,
    [ValidateRange(0,2000)][int]$TargetRps = 0,
    [ValidateRange(1,1000)][int]$Concurrency = 100,
    [ValidatePattern('^air-perf-[a-z0-9-]+:local$')][string]$Image = 'air-perf-publisher-drain:local',
    [switch]$JdbcTiming,
    [ValidateRange(0.01,1.0)][double]$JdbcSampleRate = 1.0,
    [switch]$PostgresCounters,
    [ValidateSet(10,20)][int]$PoolSize = 10,
    [ValidateSet(0,4)][int]$BackgroundPoolSize = 0,
    [ValidateSet(1,4)][int]$LoadWorkers = 1,
    [switch]$HttpTransportTiming,
    [ValidateSet('host','container')][string]$ClientLocation = 'host',
    [switch]$ObserverProcess,
    [switch]$JvmProfile,
    [switch]$PlanWaitDiagnostics,
    [bool]$MarkServerPrepareDisabled = $false,
    [ValidatePattern('^air-perf-markcustom-[a-z0-9-]+$')][string]$SnapshotPgVolume,
    [ValidatePattern('^air-perf-drain-markcustom-[a-z0-9-]+_default$')][string]$SnapshotNetwork,
    [switch]$Seed,
    [switch]$StopStack
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if ($AppPort -eq $RabbitPort -or $ArticleOffset + $ArticleCount - 1 -gt 2000) { throw '端口或文章范围无效' }
if ($Scenario -eq 'mixed' -and $Requests % 2 -ne 0) { throw '混合轮需要偶数请求' }
if (($DurationSeconds -gt 0) -ne ($TargetRps -gt 0) -or ($Scenario -eq 'mixed' -and $TargetRps % 2 -ne 0)) { throw '持续压测需要时长与目标RPS，混合RPS应为偶数' }
$resultFile = "target/$Label.jsonl"
if (Test-Path $resultFile) { throw "已有实验记录 $resultFile；请使用新的 Label" }
$env:PERF_APP_IMAGE = $Image
$env:PERF_HOST_PORT = "$AppPort"
$env:PERF_RABBIT_MANAGEMENT_PORT = "$RabbitPort"
$env:PERF_TIMING_ENABLED = 'true'
$env:PERF_JDBC_TIMING_ENABLED = "$($JdbcTiming.IsPresent)".ToLowerInvariant()
$env:PERF_JDBC_SAMPLE_RATE = $JdbcSampleRate.ToString([Globalization.CultureInfo]::InvariantCulture)
$env:PERF_PG_ENABLED = "$($PostgresCounters.IsPresent)".ToLowerInvariant()
$env:PERF_PG_COUNTERS = $(if ($PostgresCounters) { '1' } else { '0' })
$env:PERF_RATE_LIMIT_ENABLED = 'false'
$env:PERF_PUBLISHER_MAX_BATCHES = "$PublisherBatches"
$env:PERF_MARK_SERVER_PREPARE_DISABLED = $MarkServerPrepareDisabled.ToString().ToLowerInvariant()
$env:PERF_PUBLISHER_RUN_BUDGET_MS = '250'
$env:PERF_CONSUMER_BATCH_SIZE = "$ConsumerBatchSize"
$env:PERF_DB_POOL_SIZE = "$PoolSize"
if($LoadWorkers -gt 1 -and ($DurationSeconds -lt 1 -or $Concurrency % $LoadWorkers -ne 0 -or
    ($TargetRps / $(if($Scenario -eq 'mixed'){2}else{1})) % $LoadWorkers -ne 0)){throw 'Worker mode requires duration and evenly divisible rate/concurrency'}
$env:PERF_BACKGROUND_POOL_SIZE = "$BackgroundPoolSize"
$env:PERF_LOAD_WORKERS = "$LoadWorkers"
$env:PERF_HTTP_TRANSPORT_TIMING = $(if ($HttpTransportTiming) { '1' } else { '0' })
$env:PERF_OBSERVER_PROCESS = $(if ($ObserverProcess) { '1' } else { '0' })
$composeArgs = @('compose','-p',$Project,'--env-file','target/perf.env','-f','perf/compose.yml','-f','perf/compose-observe.yml')
if ($PostgresCounters) { $composeArgs += @('-f','perf/compose-pg-io.yml') }
if ($JvmProfile) { $composeArgs += @('-f','perf/compose-jfr.yml') }
if ($SnapshotPgVolume) {
    $env:PERF_SNAPSHOT_PG_VOLUME=$SnapshotPgVolume
    $composeArgs += @('-f','perf/compose-snapshot.yml')
}
if ($SnapshotNetwork) {
    if (-not $SnapshotPgVolume) { throw 'Shared experiment network requires an isolated snapshot volume' }
    $env:PERF_SNAPSHOT_NETWORK=$SnapshotNetwork
    $composeArgs += @('-f','perf/compose-snapshot-network.yml')
}
if ($PlanWaitDiagnostics) {
    if (-not $PostgresCounters -or -not $JvmProfile -or -not $StopStack) { throw 'Plan/wait diagnostics require PG, JFR and StopStack' }
    $composeArgs += @('-f','perf/compose-plan-waits.yml')
}
try {
& docker @composeArgs up -d --wait app *> "target/$Label-setup.log"
if ($LASTEXITCODE -ne 0) { throw '独立实验栈启动失败，检查 setup.log' }
$ready = $false
for ($attempt = 0; $attempt -lt 45; $attempt++) {
    try { if ((Invoke-RestMethod "http://127.0.0.1:$AppPort/api/v1/health" -TimeoutSec 2).status -eq 'UP') { $ready = $true; break } } catch {}
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw '应用健康检查超时' }
$postgresContainer = "$Project-postgres-1"
if ($PostgresCounters) {
    & docker exec $postgresContainer psql -v ON_ERROR_STOP=1 -U air_perf -d air_perf -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements' *> "target/$Label-pg-extension.log"
    if ($LASTEXITCODE -ne 0) { throw 'pg_stat_statements 初始化失败' }
}
if ($Seed) {
    $existing = & docker exec $postgresContainer psql -U air_perf -d air_perf -Atc "SELECT count(*) FROM content_items WHERE id='perf-article-1'"
    if ($LASTEXITCODE -ne 0 -or $existing -ne '0') { throw 'Seed 只允许用于尚无压测夹具的新实验库' }
    Get-Content perf/seed.sql -Raw | & docker exec -i $postgresContainer psql -v ON_ERROR_STOP=1 -U air_perf -d air_perf *> "target/$Label-seed.log"
    if ($LASTEXITCODE -ne 0) { throw '文章夹具写入失败' }
    Get-Content perf/seed-metric-users.sql -Raw | & docker exec -i $postgresContainer psql -v ON_ERROR_STOP=1 -U air_perf -d air_perf >> "target/$Label-seed.log"
    if ($LASTEXITCODE -ne 0) { throw '用户夹具写入失败' }
}
$pendingBefore = & docker exec $postgresContainer psql -U air_perf -d air_perf -Atc 'SELECT count(*) FROM article_metric_outbox WHERE published_at IS NULL'
if ($LASTEXITCODE -ne 0 -or $pendingBefore -ne '0') { throw '上一轮 outbox 尚未排空' }
if ($PlanWaitDiagnostics) {
    & docker cp perf/observe-pg-waits.sql "${postgresContainer}:/tmp/article-perf-waits.sql"
    if ($LASTEXITCODE -ne 0) { throw 'Wait observer installation failed' }
    & docker cp perf/observe-linux.sh "${postgresContainer}:/tmp/article-perf-linux.sh"
    if ($LASTEXITCODE -ne 0) { throw 'Linux observer installation failed' }
    Get-Content perf/plan-state.sql -Raw | & docker exec -i $postgresContainer psql -X -U air_perf -d air_perf -At > "target/$Label-plan-before.jsonl"
    if ($LASTEXITCODE -ne 0) { throw 'Plan state capture failed' }
    $diagnosticRoot=(Get-Location).Path
    $waitJob=Start-Job -ArgumentList $postgresContainer,$diagnosticRoot,$Label -ScriptBlock {
        param($container,$root,$label)
        & docker exec $container timeout 900 psql -X -U air_perf -d air_perf -v ON_ERROR_STOP=1 -f /tmp/article-perf-waits.sql 1> "$root/target/$label-pg-waits.log" 2> "$root/target/$label-pg-waits.err"
    }
    $linuxJob=Start-Job -ArgumentList $postgresContainer,$diagnosticRoot,$Label -ScriptBlock {
        param($container,$root,$label)
        & docker exec $container timeout 900 sh /tmp/article-perf-linux.sh 1> "$root/target/$label-linux.log" 2> "$root/target/$label-linux.err"
    }
    $hostJob=Start-Job -ArgumentList $diagnosticRoot,$Label -ScriptBlock {
        param($root,$label)
        try { while($true){
            $wsl=Get-Process -Name VmmemWSL -ErrorAction SilentlyContinue
            [ordered]@{atEpochMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();cpuSeconds=$wsl.CPU;workingSetBytes=$wsl.WorkingSet64} | ConvertTo-Json -Compress | Add-Content "$root/target/$label-host.jsonl"
            Start-Sleep -Milliseconds 1000
        }} finally { }
    }
}
foreach ($line in Get-Content target/perf.env) {
    foreach ($name in @('PERF_USER_PASSWORD','PERF_RABBIT_PASSWORD')) {
        if ($line.StartsWith("$name=")) { [Environment]::SetEnvironmentVariable($name, $line.Substring($name.Length + 1), 'Process') }
    }
}
$env:PERF_BASE_URL = "http://127.0.0.1:$AppPort"
$env:PERF_RABBIT_MANAGEMENT_URL = "http://127.0.0.1:$RabbitPort"
$env:PERF_CONTAINER_STACK = '0'
if ($ClientLocation -eq 'container') {
    $env:PERF_BASE_URL = 'http://app:8081'
    $env:PERF_RABBIT_MANAGEMENT_URL = 'http://rabbitmq:15672'
    $env:PERF_CONTAINER_STACK = '1'
}
$env:PERF_COMPARE_SCENARIO = $Scenario
$env:PERF_COMPARE_REQUESTS = "$Requests"
$env:PERF_DURATION_SECONDS = "$DurationSeconds"
$env:PERF_TARGET_RPS = "$TargetRps"
$env:PERF_BURST_CONCURRENCY = "$Concurrency"
$env:PERF_LOGIN_CONCURRENCY = '4'
$env:PERF_ARTICLE_COUNT = "$ArticleCount"
$env:PERF_ARTICLE_OFFSET = "$ArticleOffset"
$env:PERF_TIMING = '1'
$env:PERF_TIMELINE = '1'
$imageId = & docker image inspect $env:PERF_APP_IMAGE --format '{{.Id}}'
if ($LASTEXITCODE -ne 0) { throw '实验镜像标识读取失败' }
$appStartedAt = & docker inspect "$Project-app-1" --format '{{.State.StartedAt}}'
if ($LASTEXITCODE -ne 0) { throw '实验应用启动时间读取失败' }
$clientImageId = $null
if ($ClientLocation -eq 'container') {
    $clientImageId = & docker image inspect node:24.15.0-alpine --format '{{.Id}}'
    if ($LASTEXITCODE -ne 0) { throw '请先准备 node:24.15.0-alpine 客户端镜像' }
}
[ordered]@{ project=$Project; label=$Label; image=$env:PERF_APP_IMAGE; imageId=$imageId;
    appStartedAt=$appStartedAt;
    publisherMaxBatches=$PublisherBatches; publisherRunBudgetMs=250; consumerBatchSize=$ConsumerBatchSize;
    jdbcTiming=$JdbcTiming.IsPresent; jdbcSampleRate=$JdbcSampleRate; postgresCounters=$PostgresCounters.IsPresent;
    poolSize=$PoolSize; backgroundPoolSize=$BackgroundPoolSize; loadWorkers=$LoadWorkers; httpTransportTiming=$HttpTransportTiming.IsPresent;
    clientLocation=$ClientLocation; clientImageId=$clientImageId;
    articleCount=$ArticleCount; articleOffset=$ArticleOffset; scenario=$Scenario;
    requests=$(if($DurationSeconds -gt 0){$DurationSeconds*$TargetRps}else{$Requests}); concurrency=$Concurrency;
    durationSeconds=$DurationSeconds; targetRps=$TargetRps; rateLimitEnabled=$false;
    observerProcess=$ObserverProcess.IsPresent; jvmProfile=$JvmProfile.IsPresent;
    planWaitDiagnostics=$PlanWaitDiagnostics.IsPresent; markServerPrepareDisabled=$MarkServerPrepareDisabled;
    snapshotPgVolume=$SnapshotPgVolume; snapshotNetwork=$SnapshotNetwork } |
    ConvertTo-Json | Set-Content "target/$Label-config.json" -Encoding utf8
Write-Output "Running $Label publisher=$PublisherBatches consumer=$ConsumerBatchSize articles=$ArticleCount offset=$ArticleOffset"
if ($ClientLocation -eq 'container') {
    $perfDirectory = (Resolve-Path perf).Path
    $clientNetwork = if ($SnapshotNetwork) { $SnapshotNetwork } else { "${Project}_default" }
    $clientArgs = @('run','--rm','--network',$clientNetwork,'--mount',
        "type=bind,source=$perfDirectory,target=/work/perf,readonly",'--workdir','/work')
    foreach ($name in @('PERF_USER_PASSWORD','PERF_RABBIT_PASSWORD','PERF_BASE_URL','PERF_RABBIT_MANAGEMENT_URL',
        'PERF_CONTAINER_STACK','PERF_COMPARE_SCENARIO','PERF_COMPARE_REQUESTS','PERF_BURST_CONCURRENCY',
        'PERF_LOGIN_CONCURRENCY','PERF_ARTICLE_COUNT','PERF_ARTICLE_OFFSET','PERF_TIMING','PERF_TIMELINE',
        'PERF_PG_COUNTERS','PERF_HTTP_TRANSPORT_TIMING','PERF_DB_POOL_SIZE','PERF_BACKGROUND_POOL_SIZE','PERF_LOAD_WORKERS','PERF_DURATION_SECONDS','PERF_TARGET_RPS','PERF_OBSERVER_PROCESS')) { $clientArgs += @('-e',$name) }
    $clientArgs += @('node:24.15.0-alpine','node','perf/article-metrics-compare.mjs')
    & docker @clientArgs 1> $resultFile 2> "target/$Label.err"
} else { & node perf/article-metrics-compare.mjs 1> $resultFile 2> "target/$Label.err" }
if ($LASTEXITCODE -ne 0) { throw "负载未达到预期业务结果，检查 target/$Label.err" }
$events = Get-Content $resultFile | ForEach-Object { $_ | ConvertFrom-Json }
$comparisonResult = $events | Where-Object event -eq 'comparison-result' | Select-Object -First 1
$expectedRequests = $Requests
if ($DurationSeconds -gt 0) {
    $loadResult = $events | Where-Object event -eq 'sustained-load' | Select-Object -First 1
    if ($null -eq $loadResult -or $loadResult.plannedRequests -ne $DurationSeconds*$TargetRps -or
        $loadResult.startedRequests + $loadResult.droppedBusyRequests + $loadResult.droppedLateRequests -ne $loadResult.plannedRequests -or
        $comparisonResult.requests -ne $loadResult.startedRequests -or $loadResult.elapsedSeconds -lt $DurationSeconds*0.99) { throw '持续发压计数或时长不完整' }
    $expectedRequests = $loadResult.startedRequests
}
if($null -eq $comparisonResult -or $comparisonResult.requests -ne $expectedRequests -or $comparisonResult.outcomes.changed -ne $expectedRequests){throw '有效业务写入数量不匹配'}
if ($HttpTransportTiming) {
    $events = Get-Content $resultFile | ForEach-Object { $_ | ConvertFrom-Json }
    $transport = $events | Where-Object event -eq 'comparison-transport' | Select-Object -First 1
    $timingResult = $events | Where-Object event -eq 'comparison-timing' | Select-Object -First 1
    if ($null -eq $transport -or $transport.samples -ne $expectedRequests -or $transport.missing -ne 0 -or
        $transport.stages.awaitHeadersResidual.samples -ne $expectedRequests -or
        $timingResult.stages.tomcatPreFilter.samples -ne $expectedRequests) { throw 'HTTP 传输或 Tomcat 入口计时覆盖不完整' }
}
if ($JdbcTiming) {
    $httpJdbcCounts = Get-Content $resultFile | ForEach-Object { $_ | ConvertFrom-Json } |
        Where-Object event -eq 'comparison-jdbc-counts' | Select-Object -First 1
    $sampleCount = if ($null -eq $httpJdbcCounts) { 0 } else { $httpJdbcCounts.samples }
    if ($sampleCount -lt [Math]::Max(1, $expectedRequests * $JdbcSampleRate * 0.5) -or
        ($JdbcSampleRate -eq 1 -and $sampleCount -ne $expectedRequests) -or
        $httpJdbcCounts.counts.borrowed.total -lt 2 * $sampleCount -or
        $httpJdbcCounts.counts.sqlCalls.total -lt 3 * $sampleCount -or
        $httpJdbcCounts.counts.commitCalls.total -ne $sampleCount -or
        $httpJdbcCounts.counts.borrowed.total -ne $httpJdbcCounts.counts.closed.total -or
        $httpJdbcCounts.counts.sqlFailures.total -ne 0 -or $httpJdbcCounts.counts.commitFailures.total -ne 0 -or
        $httpJdbcCounts.counts.closeFailures.total -ne 0) { throw 'HTTP JDBC 样本覆盖或连接归还核对失败' }
}
$appLogs = & docker logs "$Project-app-1" 2>&1
foreach ($kind in @('PUBLISHER','CONSUMER')) {
    $marker = "PERF_ARTICLE_$kind "
    $appLogs | ForEach-Object { $line = "$_"; $position = $line.IndexOf($marker); if ($position -ge 0) { $line.Substring($position + $marker.Length) } } |
        Set-Content "target/$Label-$($kind.ToLowerInvariant()).jsonl" -Encoding utf8
}
& node perf/summarize-publisher.mjs "target/$Label-publisher.jsonl" $resultFile > "target/$Label-publisher-summary.jsonl"
if ($LASTEXITCODE -ne 0) { throw '发布器汇总失败' }
& node perf/summarize-consumer-batch.mjs "target/$Label-consumer.jsonl" $resultFile > "target/$Label-consumer-summary.jsonl"
if ($LASTEXITCODE -ne 0) { throw '消费者汇总失败' }
$lastArticle = $ArticleOffset + $ArticleCount - 1
$validationSql = @"
WITH selected AS (SELECT id FROM content_items WHERE id IN
  (SELECT 'perf-article-' || n FROM generate_series($ArticleOffset,$lastArticle) n)),
facts AS (SELECT c.id,
  (SELECT count(*) FROM article_view_events WHERE article_id=c.id) views,
  (SELECT count(*) FROM article_likes WHERE article_id=c.id) likes FROM selected c),
checks AS (SELECT f.*,coalesce(s.view_count,0) stat_views,coalesce(s.like_count,0) stat_likes
  FROM facts f LEFT JOIN article_stats s ON s.article_id=f.id)
SELECT json_build_object('articles',count(*),'views',sum(views),'likes',sum(likes),
  'statsViews',sum(stat_views),'statsLikes',sum(stat_likes),
  'wrongArticles',count(*) FILTER (WHERE views<>stat_views OR likes<>stat_likes),
  'outbox',(SELECT count(*) FROM article_metric_outbox WHERE article_id IN (SELECT id FROM selected)),
  'processed',(SELECT count(*) FROM article_metric_processed p JOIN article_metric_outbox o ON o.id=p.event_id
    WHERE o.article_id IN (SELECT id FROM selected)),
  'unpublished',(SELECT count(*) FROM article_metric_outbox WHERE published_at IS NULL)) FROM checks;
"@
$validation = & docker exec $postgresContainer psql -v ON_ERROR_STOP=1 -U air_perf -d air_perf -Atc $validationSql
if ($LASTEXITCODE -ne 0) { throw '数据库核对失败' }
$checked = $validation | ConvertFrom-Json
if ($checked.articles -ne $ArticleCount -or $checked.wrongArticles -ne 0 -or $checked.unpublished -ne 0 -or $checked.outbox -ne $checked.processed) {
    throw '数据库事实、统计和防重记录不一致'
}
if($checked.outbox -ne $expectedRequests -or $checked.views -ne $(if($Scenario -eq 'mixed'){$expectedRequests/2}else{$expectedRequests}) -or
    $checked.likes -ne $(if($Scenario -eq 'mixed'){$expectedRequests/2}else{0})){throw '数据库最终业务数量不匹配'}
$validation | Set-Content "target/$Label-validation.json" -Encoding utf8
& docker exec "$Project-rabbitmq-1" rabbitmqctl list_queues name messages_ready messages_unacknowledged > "target/$Label-queues.txt"
if ($LASTEXITCODE -ne 0) { throw '队列核对失败' }
Select-String -Path $resultFile -Pattern 'comparison-result|pipeline-drained|wait-summary|article-fairness-summary' | ForEach-Object Line
Write-Output $validation
if ($PlanWaitDiagnostics) {
    Get-Content perf/plan-state.sql -Raw | & docker exec -i $postgresContainer psql -X -U air_perf -d air_perf -At > "target/$Label-plan-after.jsonl"
    if ($LASTEXITCODE -ne 0) { throw 'Plan state capture failed' }
}
if ($StopStack) { & docker @composeArgs stop; if ($LASTEXITCODE -ne 0) { throw '实验容器停止失败' } }
$stackStopped=$StopStack.IsPresent
if ($PostgresCounters) {
    & docker logs $postgresContainer 2>&1 | Set-Content "target/$Label-postgres.log" -Encoding utf8
    if($LASTEXITCODE -ne 0){throw 'PostgreSQL log collection failed'}
}
if ($JvmProfile -and $StopStack) {
    & docker cp "${Project}-app-1:/tmp/article-perf.jfr" "target/$Label.jfr"
    if($LASTEXITCODE -ne 0){throw 'JFR collection failed'}
    & docker cp "${Project}-app-1:/tmp/article-gc.log" "target/$Label-gc.log"
    if($LASTEXITCODE -ne 0){throw 'GC log collection failed'}
}
} finally {
    if ($PlanWaitDiagnostics) {
        @($waitJob,$linuxJob,$hostJob) | Where-Object { $null -ne $_ } | Stop-Job
        @($waitJob,$linuxJob,$hostJob) | Where-Object { $null -ne $_ } | Remove-Job
        if (-not $stackStopped) { & docker @composeArgs stop }
    }
}
