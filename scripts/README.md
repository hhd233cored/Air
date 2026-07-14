# Article import/export scripts

These PowerShell scripts use the local Java API and do not require direct database access.

## Export

Export all published articles into `article-export/`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/export-articles.ps1
```

The output contains:

```text
article-export/
  manifest.json
  articles/
    first-note.md
    ...
```

## Import

Import the exported files as drafts:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/import-articles.ps1
```

Import and publish them immediately:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/import-articles.ps1 -Publish
```

Update existing articles with the same slug instead of creating duplicates:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/import-articles.ps1 -UpdateExisting -Publish
```

The scripts export and import `coverUrl` as article metadata. The image file itself is not copied; local cover URLs such as `/article-covers/first-note.svg` must exist in the target frontend's `public/` directory.
