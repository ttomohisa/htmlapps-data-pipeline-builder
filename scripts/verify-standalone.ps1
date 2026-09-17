param(
  [Parameter(Mandatory = $true)]
  [string]$Path,
  [bool]$RequireNetworkBlock = $true,
  [bool]$RequireCanonicalIcon = $true,
  [string[]]$ForbiddenPlaceholders = @(
    "__APP_CONFIG_JSON__",
    "__BUILD_MANIFEST_JSON__",
    "__EMBEDDED_ASSET_BUNDLE_JSON__",
    "__APP_ICON_DATA_URI__"
  )
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path $Path)) { throw "HTML file not found: $Path" }
$html = Get-Content -Raw -Encoding UTF8 $Path

$checks = @(
  @{ Message = "HTML document marker is missing"; Failed = -not $html.TrimStart().StartsWith("<!doctype html>", [StringComparison]::OrdinalIgnoreCase) },
  @{ Message = "Viewport metadata is missing"; Failed = $html -notmatch '<meta\s+name=["'']viewport["'']' },
  @{ Message = "An external script URL remains"; Failed = $html -match '<script[^>]+src\s*=\s*["'']https?://' },
  @{ Message = "An external stylesheet URL remains"; Failed = $html -match '<link[^>]+href\s*=\s*["'']https?://' },
  @{ Message = "An external frame URL remains"; Failed = $html -match '<(?:iframe|frame)[^>]+src\s*=\s*["'']https?://' },
  @{ Message = "An external CSS url() remains"; Failed = $html -match 'url\(\s*["'']?https?://' },
  @{ Message = "An external module import remains"; Failed = $html -match '(?:import\s+.+?from\s*|import\s*\()\s*["'']https?://' }
)

foreach ($placeholder in @($ForbiddenPlaceholders)) {
  if ([string]::IsNullOrWhiteSpace([string]$placeholder)) { continue }
  if ($html.Contains([string]$placeholder)) {
    throw "Build placeholder remains: $placeholder"
  }
}

if ($RequireNetworkBlock -and $html -notmatch "connect-src\s+'none'") {
  throw "connect-src 'none' is missing from Content Security Policy"
}

if ($RequireCanonicalIcon) {
  $faviconMatch = [regex]::Match($html, '<link[^>]+rel=["'']icon["''][^>]+href=["''](?<uri>data:image/svg\+xml;base64,[A-Za-z0-9+/=]+)["'']')
  $brandIconMatch = [regex]::Match($html, '<img[^>]+id=["'']appBrandIcon["''][^>]+src=["''](?<uri>data:image/svg\+xml;base64,[A-Za-z0-9+/=]+)["'']')
  if (-not $faviconMatch.Success) {
    throw "Embedded SVG favicon is missing from standalone HTML"
  }
  if (-not $brandIconMatch.Success) {
    throw "Header brand icon is missing from standalone HTML"
  }
  if ($faviconMatch.Groups["uri"].Value -ne $brandIconMatch.Groups["uri"].Value) {
    throw "Header brand icon must use the exact same embedded SVG asset as the favicon"
  }
}

foreach ($check in $checks) {
  if ($check.Failed) { throw $check.Message }
}

Write-Host "[OK] Standalone verification passed: $Path" -ForegroundColor Green
