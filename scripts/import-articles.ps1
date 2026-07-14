param(
    [string]$BaseUrl = "http://localhost:8080",
    [string]$InputDirectory = ".\article-export",
    [string]$PublicDirectory = ".\public",
    [int]$TimeoutSec = 15,
    [switch]$Publish,
    [switch]$UpdateExisting
)

$ErrorActionPreference = "Stop"
$apiRoot = "$($BaseUrl.TrimEnd('/'))/api/v1"
$inputRoot = [System.IO.Path]::GetFullPath($InputDirectory)
$publicRoot = [System.IO.Path]::GetFullPath($PublicDirectory)
$manifestPath = Join-Path $inputRoot "manifest.json"

if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "manifest.json was not found in $inputRoot"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($manifest.format -ne "your-space-articles-v1") {
    throw "Unsupported article export format: $($manifest.format)"
}

function Invoke-ArticleApi {
    param(
        [string]$Uri,
        [string]$Method = "Get",
        [string]$Body,
        [string]$ContentType
    )

    $requestArgs = @{
        Uri = $Uri
        Method = $Method
        TimeoutSec = $TimeoutSec
    }
    if (-not [string]::IsNullOrWhiteSpace($Body)) { $requestArgs.Body = $Body }
    if (-not [string]::IsNullOrWhiteSpace($ContentType)) { $requestArgs.ContentType = $ContentType }
    Invoke-RestMethod @requestArgs
}

$existingBySlug = @{}
if ($UpdateExisting) {
    $page = 0
    do {
        $response = Invoke-ArticleApi -Uri "$apiRoot/articles?page=$page&size=50"
        foreach ($article in @($response.content)) {
            $existingBySlug[$article.slug] = $article
        }
        $page += 1
    } while ($page -lt [int]$response.totalPages)
}

foreach ($item in @($manifest.articles)) {
    Write-Host "Processing $($item.slug)..."
    $contentPath = Join-Path $inputRoot ([string]$item.contentFile).Replace('/', '\')
    if (-not (Test-Path -LiteralPath $contentPath)) {
        Write-Warning "Skipped $($item.slug): Markdown file not found at $contentPath"
        continue
    }

    $coverUrl = [string]$item.coverUrl
    $coverFile = [string]$item.coverFile
    if (-not [string]::IsNullOrWhiteSpace($coverFile)) {
        $exportedCoverPath = Join-Path $inputRoot $coverFile.Replace('/', '\')
        if (Test-Path -LiteralPath $exportedCoverPath) {
            $coverName = [System.IO.Path]::GetFileName($exportedCoverPath)
            $coverExtension = [System.IO.Path]::GetExtension($coverName).ToLowerInvariant()
            $supportedExtensions = @('.svg', '.png', '.jpg', '.jpeg', '.webp')
            if ($supportedExtensions -notcontains $coverExtension) {
                Write-Warning "Cover format is not one of SVG/PNG/JPG/JPEG/WebP for $($item.slug): $coverExtension"
            }
            $coverTargetUrl = if ($coverUrl.StartsWith('/')) { $coverUrl } else { "/article-covers/$coverName" }
            $coverTargetPath = Join-Path $publicRoot $coverTargetUrl.TrimStart('/').Replace('/', '\')
            New-Item -ItemType Directory -Path (Split-Path -Parent $coverTargetPath) -Force | Out-Null
            $sourceFullPath = [System.IO.Path]::GetFullPath($exportedCoverPath)
            $targetFullPath = [System.IO.Path]::GetFullPath($coverTargetPath)
            if ($sourceFullPath -ne $targetFullPath) {
                [System.IO.File]::Copy($sourceFullPath, $targetFullPath, $true)
            }
            $coverUrl = $coverTargetUrl
        } else {
            Write-Warning "Cover file not found for $($item.slug): $exportedCoverPath"
        }
    }

    $payload = [ordered]@{
        slug = $item.slug
        title = $item.title
        summary = $item.summary
        coverUrl = if ([string]::IsNullOrWhiteSpace($coverUrl)) { $null } else { $coverUrl }
        contentMarkdown = [System.IO.File]::ReadAllText($contentPath, [System.Text.Encoding]::UTF8)
        tags = @($item.tags)
    }
    $json = $payload | ConvertTo-Json -Depth 8
    $existing = if ($UpdateExisting) { $existingBySlug[$item.slug] } else { $null }

    if ($existing) {
        $result = Invoke-ArticleApi -Uri "$apiRoot/articles/$($existing.id)" -Method Put -ContentType "application/json; charset=utf-8" -Body $json
        $action = "updated"
    } else {
        $result = Invoke-ArticleApi -Uri "$apiRoot/articles" -Method Post -ContentType "application/json; charset=utf-8" -Body $json
        $action = "created"
    }

    if ($Publish -and $result.status -ne "PUBLISHED") {
        $result = Invoke-ArticleApi -Uri "$apiRoot/articles/$($result.id)/publish" -Method Post
        $action = "$action and published"
    }

    Write-Host "${action}: $($item.slug)"
}
