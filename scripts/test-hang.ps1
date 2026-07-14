param(
    [string]$BaseUrl = "http://localhost:8080",
    [string]$InputDirectory = ".\article-export",
    [string]$PublicDirectory = ".\public",
    [switch]$Publish,
    [switch]$UpdateExisting
)

$ErrorActionPreference = "Stop"
Write-Host "Step 0: Script started"

$apiRoot = "$($BaseUrl.TrimEnd('/'))/api/v1"
$inputRoot = [System.IO.Path]::GetFullPath($InputDirectory)
$publicRoot = [System.IO.Path]::GetFullPath($PublicDirectory)
$manifestPath = Join-Path $inputRoot "manifest.json"

Write-Host "Step 1: Reading manifest..."
if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "manifest.json was not found in $inputRoot"
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
Write-Host "Step 2: Manifest loaded, format=$($manifest.format)"

Write-Host "Step 3: Checking UpdateExisting=$UpdateExisting"
$existingBySlug = @{}
if ($UpdateExisting) {
    Write-Host "Step 3a: Fetching existing articles..."
    $page = 0
    do {
        Write-Host "  Fetching page $page..."
        $response = Invoke-RestMethod -Uri "$apiRoot/articles?page=$page&size=50" -Method Get
        Write-Host "  Page ${page}: got $($response.content.Count) articles, totalPages=$($response.totalPages)"
        foreach ($article in @($response.content)) {
            $existingBySlug[$article.slug] = $article
        }
        $page += 1
    } while ($page -lt [int]$response.totalPages)
    Write-Host "Step 3b: Done fetching, found $($existingBySlug.Count) articles"
}

Write-Host "Step 4: Starting article loop..."
foreach ($item in @($manifest.articles)) {
    Write-Host "  Processing: $($item.slug)"

    $contentPath = Join-Path $inputRoot ([string]$item.contentFile).Replace('/', '\')
    Write-Host "  contentPath=$contentPath exists=$(Test-Path -LiteralPath $contentPath)"

    $coverUrl = [string]$item.coverUrl
    $coverFile = [string]$item.coverFile
    Write-Host "  coverUrl=$coverUrl coverFile=$coverFile"
}

Write-Host "Step 5: Testing cover copy for building-a-place-for-notes..."
$item = $manifest.articles[2]
$coverUrl = [string]$item.coverUrl
$coverFile = [string]$item.coverFile
$exportedCoverPath = Join-Path $inputRoot $coverFile.Replace('/', '\')
Write-Host "  exportedCoverPath=$exportedCoverPath exists=$(Test-Path -LiteralPath $exportedCoverPath)"

if (Test-Path -LiteralPath $exportedCoverPath) {
    $coverName = [System.IO.Path]::GetFileName($exportedCoverPath)
    $coverExtension = [System.IO.Path]::GetExtension($coverName).ToLowerInvariant()
    Write-Host "  coverName=$coverName extension=$coverExtension"

    $coverTargetUrl = "/article-covers/$coverName"
    $coverTargetPath = Join-Path $publicRoot $coverTargetUrl.TrimStart('/').Replace('/', '\')
    Write-Host "  coverTargetPath=$coverTargetPath"

    Write-Host "  Creating directory..."
    New-Item -ItemType Directory -Path (Split-Path -Parent $coverTargetPath) -Force | Out-Null
    Write-Host "  Directory created"

    Write-Host "  Copying cover..."
    Copy-Item -LiteralPath $exportedCoverPath -Destination $coverTargetPath -Force
    Write-Host "  Cover copied"
}

Write-Host "Step 6: Testing HTTP PUT for first-note..."
$firstNote = $manifest.articles[0]
$contentPath = Join-Path $inputRoot ([string]$firstNote.contentFile).Replace('/', '\')
$payload = [ordered]@{
    slug = $firstNote.slug
    title = $firstNote.title
    summary = $firstNote.summary
    coverUrl = $null
    contentMarkdown = Get-Content -LiteralPath $contentPath -Raw -Encoding utf8
    tags = @($firstNote.tags)
}
Write-Host "  Payload built, checking contentMarkdown length..."
$mdLength = $payload.contentMarkdown.Length
Write-Host "  contentMarkdown length: $mdLength"

Write-Host "  Testing ConvertTo-Json with Depth 2..."
try {
    $testJson = $payload | ConvertTo-Json -Depth 2
    Write-Host "  Depth 2 worked: $($testJson.Length) chars"
} catch {
    Write-Host "  Depth 2 failed: $($_.Exception.Message)"
}

Write-Host "  Testing ConvertTo-Json without Depth..."
try {
    $testJson2 = $payload | ConvertTo-Json
    Write-Host "  No depth worked: $($testJson2.Length) chars"
} catch {
    Write-Host "  No depth failed: $($_.Exception.Message)"
}

Write-Host "  Testing just the hashtable..."
$simple = [ordered]@{ a = 1; b = "hello" }
$simpleJson = $simple | ConvertTo-Json
Write-Host "  Simple JSON: $simpleJson"

Write-Host "  Sending PUT..."
$existingId = $existingBySlug[$firstNote.slug].id
Write-Host "  existingId=$existingId"
$result = Invoke-RestMethod -Uri "$apiRoot/articles/$existingId" -Method Put -ContentType "application/json; charset=utf-8" -Body $json
Write-Host "  PUT response received, status=$($result.status)"

Write-Host "Step 7: All tests passed!"
