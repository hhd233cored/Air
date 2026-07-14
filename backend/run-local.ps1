$ErrorActionPreference = "Stop"

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
