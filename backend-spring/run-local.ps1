param(
    [switch]$SkipDatabaseStart,
    [switch]$Test
)

$ErrorActionPreference = "Stop"
$moduleRoot = $PSScriptRoot
$envFile = Join-Path $moduleRoot ".env"

# Docker Desktop 的 per-user 安装目录不一定已进入当前终端的 PATH。
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if ($dockerCommand) {
    $dockerCli = $dockerCommand.Source
}
else {
    $dockerCli = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"
}
if (-not (Test-Path -LiteralPath $dockerCli)) {
    throw "找不到 Docker CLI。请启动 Docker Desktop，并在新 PowerShell 窗口中检查 docker 命令。"
}

# Maven Wrapper 需要 JAVA_HOME；从当前 JDK 进程属性中补出路径，避免改动用户级环境变量。
if (-not $env:JAVA_HOME) {
    $javaSettings = (& java -XshowSettings:properties -version 2>&1 | Out-String)
    if ($javaSettings -match "(?m)^\s*java.home\s*=\s*(.+)$") {
        $env:JAVA_HOME = $Matches[1].Trim()
    }
}
if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME "bin\javac.exe"))) {
    throw "需要 JDK 21，并且 JAVA_HOME 必须指向 JDK 根目录。"
}

if (-not (Test-Path -LiteralPath $envFile)) {
    throw "缺少 backend-spring/.env。请先复制 .env.example 为 .env，并设置本机 PostgreSQL 密码。"
}

# 只读取简单的 KEY=VALUE 行，不执行 .env 中的任意 PowerShell 内容。
Get-Content -LiteralPath $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#")) {
        $parts = $line -split "=", 2
        if ($parts.Length -eq 2) {
            [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
        }
    }
}

$env:SPRING_PROFILES_ACTIVE = "local"

if (-not $SkipDatabaseStart) {
    Push-Location $moduleRoot
    try {
        # 本脚本在宿主机启动 JVM，只启动依赖，避免和 Compose 中的 app 抢占 8081。
        & $dockerCli compose --env-file .env up -d --wait postgres redis rabbitmq
        if ($LASTEXITCODE -ne 0) { throw "PostgreSQL/Redis/RabbitMQ Compose 服务启动失败。" }
    }
    finally {
        Pop-Location
    }
}

Push-Location $moduleRoot
try {
    if ($Test) {
        # 集成测试使用 @ActiveProfiles("test") 载入测试夹具，并连接刚启动的本地 PostgreSQL。
        .\mvnw.cmd test
    }
    else {
        .\mvnw.cmd spring-boot:run
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Pop-Location
}
