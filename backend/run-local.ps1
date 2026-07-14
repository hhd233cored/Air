$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$pom = Join-Path $PSScriptRoot "pom.xml"
$maven = Get-Command mvn -ErrorAction SilentlyContinue

if (-not $maven) {
    throw "未找到 Maven。请安装 Maven 3.9+ 并将 bin 目录加入 PATH，然后重新运行 npm.cmd run backend:local。"
}

Push-Location $projectRoot
try {
    & $maven.Source -f $pom spring-boot:run "-Dspring-boot.run.profiles=local"
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
