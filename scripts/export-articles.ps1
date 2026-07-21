param(
    [string]$OutputDirectory = ".\article-export",
    [string]$PublicDirectory = ".\public",
    [string]$BaseUrl,
    [int]$PageSize = 50
)

$ErrorActionPreference = "Stop"
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$publicRoot = [System.IO.Path]::GetFullPath($PublicDirectory)
$articlesRoot = Join-Path $publicRoot "articles"
$outputArticlesRoot = Join-Path $outputRoot "articles"

if (-not (Test-Path -LiteralPath $articlesRoot)) {
    throw "Article directory was not found: $articlesRoot"
}

New-Item -ItemType Directory -Path $outputArticlesRoot -Force | Out-Null
$manifestArticles = @()

foreach ($sourceDirectory in @(Get-ChildItem -LiteralPath $articlesRoot -Directory)) {
    $metadataPath = Join-Path $sourceDirectory.FullName "article.json"
    $contentPath = Join-Path $sourceDirectory.FullName "article.md"
    if (-not (Test-Path -LiteralPath $metadataPath) -or -not (Test-Path -LiteralPath $contentPath)) {
        Write-Warning "Skipped incomplete article directory: $($sourceDirectory.Name)"
        continue
    }

    $metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding utf8 | ConvertFrom-Json
    $slug = [string]$metadata.slug
    $targetDirectory = Join-Path $outputArticlesRoot $slug
    New-Item -ItemType Directory -Path (Join-Path $targetDirectory "assets") -Force | Out-Null
    Copy-Item -LiteralPath $metadataPath -Destination (Join-Path $targetDirectory "article.json") -Force
    Copy-Item -LiteralPath $contentPath -Destination (Join-Path $targetDirectory "article.md") -Force

    $sourceAssets = Join-Path $sourceDirectory.FullName "assets"
    if (Test-Path -LiteralPath $sourceAssets -PathType Container) {
        foreach ($asset in @(Get-ChildItem -LiteralPath $sourceAssets -File -Recurse)) {
            $relativeAsset = $asset.FullName.Substring($sourceAssets.Length).TrimStart('\', '/')
            $targetAsset = Join-Path (Join-Path $targetDirectory "assets") $relativeAsset
            New-Item -ItemType Directory -Path (Split-Path -Parent $targetAsset) -Force | Out-Null
            Copy-Item -LiteralPath $asset.FullName -Destination $targetAsset -Force
        }
    }

    $coverFile = $null
    if (-not [string]::IsNullOrWhiteSpace([string]$metadata.cover)) {
        $sourceCover = Join-Path $sourceDirectory.FullName ([string]$metadata.cover).Replace('/', '\')
        if (Test-Path -LiteralPath $sourceCover) {
            $coverFile = "articles/$slug/$([System.IO.Path]::GetFileName($sourceCover))"
            Copy-Item -LiteralPath $sourceCover -Destination (Join-Path $targetDirectory ([System.IO.Path]::GetFileName($sourceCover))) -Force
        }
    }

    $manifestArticles += [ordered]@{
        id = $metadata.id
        slug = $slug
        title = $metadata.title
        summary = $metadata.summary
        coverUrl = if ($coverFile) { "/articles/$slug/$([System.IO.Path]::GetFileName($coverFile))" } else { $null }
        coverColor = $metadata.coverColor
        tags = @($metadata.tags)
        coverFile = $coverFile
        status = $metadata.status
        publishedAt = $metadata.publishedAt
        createdAt = $metadata.createdAt
        updatedAt = $metadata.updatedAt
        contentFile = "articles/$slug/article.md"
        assetDirectory = "articles/$slug/assets"
    }
}

$manifest = [ordered]@{
    format = "your-space-articles-v2"
    exportedAt = [DateTime]::UtcNow.ToString("o")
    articles = @($manifestArticles | Sort-Object { $_.publishedAt } -Descending)
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputRoot "manifest.json") -Encoding utf8
Write-Host "Exported $($manifestArticles.Count) article(s) to $outputRoot"
