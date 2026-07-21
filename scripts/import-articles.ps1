param(
    [string]$InputDirectory = ".\article-export",
    [string]$PublicDirectory = ".\public",
    [string]$BaseUrl,
    [string]$Username,
    [string]$Password,
    [int]$TimeoutSec = 15,
    [switch]$Publish,
    [switch]$UpdateExisting
)

$ErrorActionPreference = "Stop"
$inputRoot = [System.IO.Path]::GetFullPath($InputDirectory)
$publicRoot = [System.IO.Path]::GetFullPath($PublicDirectory)
$manifestPath = Join-Path $inputRoot "manifest.json"
$articlesRoot = Join-Path $publicRoot "articles"

if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "manifest.json was not found in $inputRoot"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($manifest.format -notin @("your-space-articles-v1", "your-space-articles-v2")) {
    throw "Unsupported article export format: $($manifest.format)"
}

New-Item -ItemType Directory -Path $articlesRoot -Force | Out-Null
$indexArticles = @()

foreach ($item in @($manifest.articles)) {
    $slug = ([string]$item.slug).Trim().ToLowerInvariant() -replace '[^a-z0-9-]', '-'
    $slug = $slug.Trim('-')
    if ([string]::IsNullOrWhiteSpace($slug)) { throw "Invalid article slug: $($item.slug)" }

    $articleDirectory = Join-Path $articlesRoot $slug
    New-Item -ItemType Directory -Path (Join-Path $articleDirectory "assets") -Force | Out-Null

    $contentPath = Join-Path $inputRoot ([string]$item.contentFile).Replace('/', '\')
    if (-not (Test-Path -LiteralPath $contentPath)) {
        Write-Warning "Skipped ${slug}: Markdown file not found at $contentPath"
        continue
    }
    Copy-Item -LiteralPath $contentPath -Destination (Join-Path $articleDirectory "article.md") -Force

    $assetDirectory = if ($item.assetDirectory) {
        Join-Path $inputRoot ([string]$item.assetDirectory).Replace('/', '\')
    } else {
        Join-Path $inputRoot "articles\$slug\assets"
    }
    if (Test-Path -LiteralPath $assetDirectory -PathType Container) {
        foreach ($asset in @(Get-ChildItem -LiteralPath $assetDirectory -File -Recurse)) {
            $relativeAsset = $asset.FullName.Substring($assetDirectory.Length).TrimStart('\', '/')
            $targetAsset = Join-Path (Join-Path $articleDirectory "assets") $relativeAsset
            New-Item -ItemType Directory -Path (Split-Path -Parent $targetAsset) -Force | Out-Null
            Copy-Item -LiteralPath $asset.FullName -Destination $targetAsset -Force
        }
    }

    $coverName = $null
    $coverFile = [string]$item.coverFile
    if (-not [string]::IsNullOrWhiteSpace($coverFile)) {
        $sourceCover = Join-Path $inputRoot $coverFile.Replace('/', '\')
        if (Test-Path -LiteralPath $sourceCover) {
            $coverName = [System.IO.Path]::GetFileName($sourceCover)
            $extension = [System.IO.Path]::GetExtension($coverName).ToLowerInvariant()
            if (@('.svg', '.png', '.jpg', '.jpeg', '.webp') -notcontains $extension) {
                Write-Warning "Unsupported cover extension for ${slug}: $extension"
            }
            Copy-Item -LiteralPath $sourceCover -Destination (Join-Path $articleDirectory $coverName) -Force
        } else {
            Write-Warning "Cover file not found for ${slug}: $sourceCover"
        }
    }

    $status = if ($Publish) { "PUBLISHED" } else { [string]$item.status }
    if ([string]::IsNullOrWhiteSpace($status)) { $status = "PUBLISHED" }
    $metadata = [ordered]@{
        id = if ($item.id) { [string]$item.id } else { [guid]::NewGuid().ToString() }
        slug = $slug
        title = [string]$item.title
        summary = if ($null -eq $item.summary) { $null } else { [string]$item.summary }
        tags = @($item.tags)
        status = $status
        publishedAt = [string]$item.publishedAt
        createdAt = [string]$item.createdAt
        updatedAt = [string]$item.updatedAt
        cover = $coverName
    }
    $metadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $articleDirectory "article.json") -Encoding utf8

    $indexArticles += [ordered]@{
        id = $metadata.id
        slug = $slug
        title = $metadata.title
        summary = $metadata.summary
        coverUrl = if ($coverName) { "/articles/$slug/$coverName" } else { $null }
        coverColor = if ($item.coverColor) { [string]$item.coverColor } else { $null }
        tags = @($metadata.tags)
        status = $status
        publishedAt = $metadata.publishedAt
        createdAt = $metadata.createdAt
        updatedAt = $metadata.updatedAt
    }
    Write-Host "Imported: $slug"
}

$indexArticles = @($indexArticles | Sort-Object { $_.publishedAt } -Descending)
$indexArticles | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $articlesRoot "index.json") -Encoding utf8
Write-Host "Generated $($indexArticles.Count) article(s) in $articlesRoot"
