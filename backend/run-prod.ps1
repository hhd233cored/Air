$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$environmentFile = Join-Path $PSScriptRoot "..\.env"
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

$java = Get-Command java -ErrorAction SilentlyContinue
if (-not $java) { throw "Java 21 was not found on PATH." }

$jar = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "target") -Filter "your-space-backend-*.jar" -File |
    Where-Object { $_.Name -notmatch "original" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $jar) { throw "Backend JAR was not found. Run npm.cmd run backend:package first." }

& $java.Source -Xms64m -Xmx256m -XX:MaxMetaspaceSize=128m -XX:+UseSerialGC -jar $jar.FullName
exit $LASTEXITCODE
