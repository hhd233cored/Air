$ErrorActionPreference = "Stop"

Write-Warning "编辑器已经整合到 Python 主后端；请使用 npm.cmd run backend:python，并在 .env 中设置 EDITOR_ENABLED=true。"
& (Join-Path $PSScriptRoot "run-local.ps1")
exit $LASTEXITCODE
