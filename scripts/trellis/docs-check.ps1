$ErrorActionPreference = 'Stop'

$docsDir = Join-Path (Get-Location) 'docs'
$patterns = 'TODO|TBD|待定|兜底|暂定'

if (-not (Test-Path -LiteralPath $docsDir)) {
    Write-Output 'docs directory not found.'
    exit 0
}

$hits = Get-ChildItem -LiteralPath $docsDir -Recurse -Filter '*.md' |
    Select-String -Pattern $patterns

if ($hits) {
    foreach ($hit in $hits) {
        Write-Error ("{0}:{1} {2}" -f $hit.Path, $hit.LineNumber, $hit.Line)
    }
    exit 1
}

Write-Output 'docs check passed.'
