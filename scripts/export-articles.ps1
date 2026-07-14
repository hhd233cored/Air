param(
    [string]$BaseUrl = "http://localhost:8080",
    [string]$OutputDirectory = ".\article-export",
    [int]$PageSize = 50
)

$ErrorActionPreference = "Stop"
$apiRoot = "$($BaseUrl.TrimEnd('/'))/api/v1"
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$articlesDirectory = Join-Path $outputRoot "articles"

New-Item -ItemType Directory -Path $articlesDirectory -Force | Out-Null

$articles = @()
$page = 0
do {
    $response = Invoke-RestMethod -Uri "$apiRoot/articles?page=$page&size=$PageSize" -Method Get
    if ($response.content) {
        $articles += @($response.content)
    }
    $page += 1
} while ($page -lt [int]$response.totalPages)

$manifestArticles = @()
foreach ($article in $articles) {
    $safeSlug = ($article.slug -replace '[^a-zA-Z0-9._-]', '-')
    if ([string]::IsNullOrWhiteSpace($safeSlug)) { $safeSlug = "article-$($article.id)" }

    $detail = Invoke-RestMethod -Uri "$apiRoot/articles/$([uri]::EscapeDataString($article.slug))" -Method Get
    $contentFile = "articles/$safeSlug.md"
    $contentPath = Join-Path $outputRoot $contentFile.Replace('/', '\')
    [System.IO.File]::WriteAllText($contentPath, [string]$detail.contentMarkdown, [System.Text.UTF8Encoding]::new($false))

    $manifestArticles += [ordered]@{
        id = $detail.id
        slug = $detail.slug
        title = $detail.title
        summary = $detail.summary
        coverUrl = $detail.coverUrl
        tags = @($detail.tags)
        status = $detail.status
        publishedAt = $detail.publishedAt
        createdAt = $detail.createdAt
        updatedAt = $detail.updatedAt
        contentFile = $contentFile
    }
}

$manifest = [ordered]@{
    format = "your-space-articles-v1"
    exportedAt = [DateTime]::UtcNow.ToString("o")
    source = $apiRoot
    articles = $manifestArticles
}
$manifestPath = Join-Path $outputRoot "manifest.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Host "Exported $($articles.Count) published article(s) to $outputRoot"
