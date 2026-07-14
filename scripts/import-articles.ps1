param(
    [string]$BaseUrl = "http://localhost:8080",
    [string]$InputDirectory = ".\article-export",
    [switch]$Publish,
    [switch]$UpdateExisting
)

$ErrorActionPreference = "Stop"
$apiRoot = "$($BaseUrl.TrimEnd('/'))/api/v1"
$inputRoot = [System.IO.Path]::GetFullPath($InputDirectory)
$manifestPath = Join-Path $inputRoot "manifest.json"

if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "manifest.json was not found in $inputRoot"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($manifest.format -ne "your-space-articles-v1") {
    throw "Unsupported article export format: $($manifest.format)"
}

$existingBySlug = @{}
if ($UpdateExisting) {
    $page = 0
    do {
        $response = Invoke-RestMethod -Uri "$apiRoot/articles?page=$page&size=50" -Method Get
        foreach ($article in @($response.content)) {
            $existingBySlug[$article.slug] = $article
        }
        $page += 1
    } while ($page -lt [int]$response.totalPages)
}

foreach ($item in @($manifest.articles)) {
    $contentPath = Join-Path $inputRoot ([string]$item.contentFile).Replace('/', '\')
    if (-not (Test-Path -LiteralPath $contentPath)) {
        Write-Warning "Skipped $($item.slug): Markdown file not found at $contentPath"
        continue
    }

    $payload = [ordered]@{
        slug = $item.slug
        title = $item.title
        summary = $item.summary
        coverUrl = $item.coverUrl
        contentMarkdown = Get-Content -LiteralPath $contentPath -Raw -Encoding utf8
        tags = @($item.tags)
    }
    $json = $payload | ConvertTo-Json -Depth 8
    $existing = if ($UpdateExisting) { $existingBySlug[$item.slug] } else { $null }

    if ($existing) {
        $result = Invoke-RestMethod -Uri "$apiRoot/articles/$($existing.id)" -Method Put -ContentType "application/json; charset=utf-8" -Body $json
        $action = "updated"
    } else {
        $result = Invoke-RestMethod -Uri "$apiRoot/articles" -Method Post -ContentType "application/json; charset=utf-8" -Body $json
        $action = "created"
    }

    if ($Publish -and $result.status -ne "PUBLISHED") {
        $result = Invoke-RestMethod -Uri "$apiRoot/articles/$($result.id)/publish" -Method Post
        $action = "$action and published"
    }

    Write-Host "${action}: $($item.slug)"
}
