param([Parameter(Mandatory)][ValidatePattern('^[a-z0-9-]+$')][string]$Label,
 [ValidatePattern('^air-perf-[a-z0-9-]+:local$')][string]$Image='air-perf-pool-http:local')
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$profileTarget=(Resolve-Path target).Path
if(-not(Test-Path -LiteralPath "target/$Label.jfr")){throw 'Missing JFR recording'}
& docker run --rm --entrypoint jfr --mount "type=bind,source=$profileTarget,target=/work,readonly" $Image summary "/work/$Label.jfr" > "target/$Label-jfr-summary.txt"
if($LASTEXITCODE -ne 0){throw 'JFR summary failed'}
foreach($profileSensitiveEvent in @('InitialEnvironmentVariable','InitialSystemProperty','SystemProcess')){
 $profileSensitiveLine=Select-String -Path "target/$Label-jfr-summary.txt" -Pattern "jdk\.$profileSensitiveEvent\s+([0-9]+)"
 if($null -eq $profileSensitiveLine -or [long]$profileSensitiveLine.Matches[0].Groups[1].Value -ne 0){throw 'JFR sensitive event gate failed'}
}
& java perf/JfrCompact.java "target/$Label.jfr" 1> "target/$Label-jfr-events.jsonl" 2> "target/$Label-jfr-parse.log"
if($LASTEXITCODE -ne 0){throw 'JFR JSON conversion failed'}
Write-Output "JFR collected $Label"
