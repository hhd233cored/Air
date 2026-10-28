param(
 [Parameter(Mandatory)][ValidatePattern('^air-perf-[a-z0-9_-]+$')][string]$SourceVolume,
 [Parameter(Mandatory)][ValidatePattern('^air-perf-markcustom-[a-z0-9-]+$')][string]$TargetVolume,
 [ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedHash
)
$ErrorActionPreference='Stop'
$snapshotMounted=@(& docker ps --filter "volume=$SourceVolume" --format '{{.Names}}')
if($LASTEXITCODE -ne 0 -or $snapshotMounted.Count -gt 0){throw 'Source volume must have no running container'}
& docker volume inspect $SourceVolume --format '{{.Name}}' > $null
if($LASTEXITCODE -ne 0){throw 'Source volume missing'}
$snapshotVolumes=@(& docker volume ls --format '{{.Name}}')
if($LASTEXITCODE -ne 0 -or $TargetVolume -in $snapshotVolumes){throw 'Target volume must be new'}
& docker volume create $TargetVolume > $null
if($LASTEXITCODE -ne 0){throw 'Target creation failed'}
& docker run --rm --mount "type=volume,source=$SourceVolume,target=/source,readonly" --mount "type=volume,source=$TargetVolume,target=/dest" --entrypoint sh postgres:18.6 -c 'test -z "$(find /dest -mindepth 1 -maxdepth 1 -print -quit)" && cp -a /source/. /dest/'
if($LASTEXITCODE -ne 0){throw 'Snapshot copy failed; preserve incomplete target for inspection'}
$snapshotHashLine=& docker run --rm --mount "type=volume,source=$TargetVolume,target=/data,readonly" --entrypoint sh postgres:18.6 -c 'cd /data && find . -type f -exec sha256sum {} + | LC_ALL=C sort | sha256sum'
if($LASTEXITCODE -ne 0 -or $snapshotHashLine -notmatch '^([a-f0-9]{64})\s'){throw 'Snapshot hash failed'}
$snapshotHash=$Matches[1]
if($ExpectedHash -and $snapshotHash -ne $ExpectedHash){throw 'Physical snapshot mismatch'}
[ordered]@{sourceVolume=$SourceVolume;targetVolume=$TargetVolume;hash=$snapshotHash;expectedHash=$ExpectedHash;checks='PASS'}|ConvertTo-Json -Compress
