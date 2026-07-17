$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $projectRoot ".env"

if (Test-Path -LiteralPath $environmentFile) {
    Get-Content -LiteralPath $environmentFile -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#') -and $line -match '^([^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
}

$pythonPath = $null
$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (Test-Path -LiteralPath $venvPython) {
    $pythonPath = (Get-Item -LiteralPath $venvPython).FullName
} else {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        $pythonPath = if ($pythonCommand.Path) { $pythonCommand.Path } else { $pythonCommand.Source }
    }
}

if (-not $pythonPath) {
    Write-Error "Python 3.11+ was not found. Install Python or create backend-python\.venv first."
    exit 1
}

$port = if ($env:SERVER_PORT) { $env:SERVER_PORT } else { "8080" }
$hostAddress = if ($env:PYTHON_HOST) { $env:PYTHON_HOST } else { "127.0.0.1" }

Push-Location $PSScriptRoot
try {
    & $pythonPath -m uvicorn app.main:app --host $hostAddress --port $port
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
