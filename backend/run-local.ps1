$ErrorActionPreference = "Stop"

# Load the repository .env into this PowerShell process so local Spring Boot
# startup can use the same article directory and API settings as production.
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

$pom = Join-Path $PSScriptRoot "pom.xml"
$maven = Get-Command mvn -ErrorAction SilentlyContinue

if (-not $maven) {
    # Try common installation paths
    $mavenCandidates = @(
        "C:\tools\apache-maven-3.9.16\bin\mvn.cmd"
        "$env:ProgramData\chocolatey\bin\mvn.cmd"
        "$env:ProgramFiles\Maven\bin\mvn.cmd"
        "${env:ProgramFiles(x86)}\Maven\bin\mvn.cmd"
        "$env:LOCALAPPDATA\Programs\apache-maven-*\bin\mvn.cmd"
        "C:\Program Files\Maven\bin\mvn.cmd"
    )
    foreach ($candidate in $mavenCandidates) {
        $resolved = Resolve-Path $candidate -ErrorAction SilentlyContinue
        if ($resolved) {
            $maven = Get-Command ($resolved.Path) -ErrorAction SilentlyContinue
            if ($maven) { break }
        }
    }
}

if (-not $maven) {
    Write-Error "Maven was not found. Install Maven 3.9+, add its bin directory to PATH, and run npm.cmd run backend:local again."
    exit 1
}

$projectRoot = Split-Path -Parent $PSScriptRoot
if ($env:ARTICLE_CONTENT_DIR -and -not [System.IO.Path]::IsPathRooted($env:ARTICLE_CONTENT_DIR)) {
    $env:ARTICLE_CONTENT_DIR = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $env:ARTICLE_CONTENT_DIR))
}

Push-Location $PSScriptRoot
try {
    $mavenPath = if ($maven.Path) { $maven.Path } else { $maven.Source }
    & $mavenPath -f $pom spring-boot:run "-Dspring-boot.run.profiles=local"
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Write-Error "Spring Boot failed. Maven exit code: $exitCode"
    }
    exit $exitCode
}
finally {
    Pop-Location
}
