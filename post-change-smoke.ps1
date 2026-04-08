<#
  What this file does:
  Runs a lightweight post-change smoke gate for the SafePrompt Guard extension.

  Why it exists:
  The last regression was not a detector bug. It was an integration bug where the
  content script was not injected on the active ChatGPT domain. This script checks
  those high-risk integration points after every code change.

  How to extend it:
  Add more required hosts, selectors, or log checkpoints as the extension grows.
#>

param(
  [string]$Root = "C:\ChromeExtension\apps\SafePrompt-Guard",
  [switch]$SkipDetectorTests
)

$ErrorActionPreference = "Stop"

$manifestPath = Join-Path $Root "manifest.json"
$detectorPath = Join-Path $Root "detector.js"
$contentPath = Join-Path $Root "content.js"
$stylesPath = Join-Path $Root "styles.css"
$passwordSourcesPath = Join-Path $Root "password-sources.js"
$detectorRunnerPath = Join-Path $Root "run-detector-tests.ps1"
$learnedStorePath = Join-Path $Root "learned-secrets-store.js"
$popupPath = Join-Path $Root "popup.js"
$popupHtmlPath = Join-Path $Root "popup.html"
$popupCssPath = Join-Path $Root "popup.css"
$dbHtmlPath = Join-Path $Root "db.html"
$dbJsPath = Join-Path $Root "db.js"
$dbCssPath = Join-Path $Root "db.css"
$brandAssetRoot = Join-Path $Root "assets\brand"
$storeAssetRoot = Join-Path $Root "assets\store"

$requiredBrandFiles = @(
  "assets\brand\icon-mark.svg",
  "assets\brand\logo-lockup.svg",
  "assets\brand\wordmark.svg",
  "assets\brand\icons\icon-16.png",
  "assets\brand\icons\icon-32.png",
  "assets\brand\icons\icon-48.png",
  "assets\brand\icons\icon-128.png"
)

$requiredStoreFiles = @(
  "assets\store\screenshots\screenshot-01-warning.png",
  "assets\store\screenshots\screenshot-02-mask-and-review.png",
  "assets\store\screenshots\screenshot-03-local-db-console.png",
  "assets\store\screenshots\screenshot-04-import-export.png",
  "assets\store\screenshots\screenshot-05-local-first.png",
  "assets\store\small-promo-440x280.png",
  "assets\store\marquee-1400x560.png",
  "assets\store\STORE_LISTING.md",
  "assets\store\VIDEO_STORYBOARD.md",
  "assets\store\RELEASE_CHECKLIST.md"
)

$errors = New-Object System.Collections.Generic.List[string]
$notes = New-Object System.Collections.Generic.List[string]

function Require-File {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    $errors.Add("Missing required file: $Path")
  }
}

function Require-Text {
  param(
    [string]$Text,
    [string]$Needle,
    [string]$Label
  )
  if (-not $Text.Contains($Needle)) {
    $errors.Add("Missing expected marker for ${Label}: $Needle")
  }
}

function Forbid-Text {
  param(
    [string]$Text,
    [string]$Needle,
    [string]$Label
  )
  if ($Text.Contains($Needle)) {
    $errors.Add("Unexpected marker still present for ${Label}: $Needle")
  }
}

Require-File -Path $manifestPath
Require-File -Path $detectorPath
Require-File -Path $contentPath
Require-File -Path $stylesPath
Require-File -Path $passwordSourcesPath
Require-File -Path $learnedStorePath
Require-File -Path $popupPath
Require-File -Path $popupHtmlPath
Require-File -Path $popupCssPath
Require-File -Path $dbHtmlPath
Require-File -Path $dbJsPath
Require-File -Path $dbCssPath

foreach ($relativePath in $requiredBrandFiles + $requiredStoreFiles) {
  Require-File -Path (Join-Path $Root $relativePath)
}

if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Host "FAIL: $_" -ForegroundColor Red }
  exit 1
}

$manifestRaw = Get-Content -LiteralPath $manifestPath -Raw
$manifest = $manifestRaw | ConvertFrom-Json
$detector = Get-Content -LiteralPath $detectorPath -Raw
$content = Get-Content -LiteralPath $contentPath -Raw
$styles = Get-Content -LiteralPath $stylesPath -Raw
$passwordSources = Get-Content -LiteralPath $passwordSourcesPath -Raw
$popup = Get-Content -LiteralPath $popupPath -Raw
$popupHtml = Get-Content -LiteralPath $popupHtmlPath -Raw
$popupCss = Get-Content -LiteralPath $popupCssPath -Raw
$dbJs = Get-Content -LiteralPath $dbJsPath -Raw
$dbHtml = Get-Content -LiteralPath $dbHtmlPath -Raw
$dbCss = Get-Content -LiteralPath $dbCssPath -Raw

$requiredHosts = @(
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://claude.ai/*",
  "https://gemini.google.com/*",
  "https://perplexity.ai/*",
  "https://www.perplexity.ai/*"
)

$contentMatches = @()
if ($manifest.content_scripts.Count -gt 0) {
  $contentMatches = @($manifest.content_scripts[0].matches)
}

$resourceMatches = @()
if ($manifest.web_accessible_resources.Count -gt 0) {
  $resourceMatches = @($manifest.web_accessible_resources[0].matches)
}

foreach ($requiredHost in $requiredHosts) {
  if (-not (@($manifest.host_permissions) -contains $requiredHost)) {
    $errors.Add("manifest.host_permissions is missing $requiredHost")
  }
  if (-not ($contentMatches -contains $requiredHost)) {
    $errors.Add("manifest.content_scripts[0].matches is missing $requiredHost")
  }
  if (-not ($resourceMatches -contains $requiredHost)) {
    $errors.Add("manifest.web_accessible_resources[0].matches is missing $requiredHost")
  }
}

foreach ($iconSize in "16", "32", "48", "128") {
  if (-not $manifest.icons.$iconSize) {
    $errors.Add("manifest.icons is missing size $iconSize")
  }
}

$requiredContentMarkers = @(
  "content script loaded",
  "editor found",
  "input change detected",
  "paste detected",
  "send button found",
  "send intercepted",
  "detector started",
  "findings returned",
  "warning UI rendered",
  "DEBUG_BADGE_ID",
  'document.addEventListener("paste"',
  'document.addEventListener("submit"',
  'document.addEventListener("click"',
  'document.addEventListener("keydown"',
  "scheduleInlineScan",
  "performInlineScan",
  "#prompt-textarea",
  "[contenteditable='true'][role='textbox']",
  "findPrioritySendButton",
  "renderWarning",
  "SELECTION_BUBBLE_ID",
  "manual-open",
  "safe-prompt-request-selection-candidate",
  "safe-prompt-learned-add",
  "safe-prompt-request-learned-secrets"
)

foreach ($marker in $requiredContentMarkers) {
  Require-Text -Text $content -Needle $marker -Label "content.js"
}

Require-Text -Text $passwordSources -Needle "commonPasswords" -Label "password-sources.js"
Require-Text -Text $passwordSources -Needle "defaultPasswords" -Label "password-sources.js"
Require-Text -Text $passwordSources -Needle "defaultCredentialPairs" -Label "password-sources.js"
Require-Text -Text $manifestRaw -Needle "password-sources.js" -Label "manifest/content script wiring"
Require-Text -Text $detector -Needle "addStaticPasswordPackCandidates" -Label "detector.js"
Require-Text -Text $detector -Needle "Known common password" -Label "detector.js"
Require-Text -Text $detector -Needle "Known default username/password pair" -Label "detector.js"

Require-Text -Text $styles -Needle "#safe-prompt-guard-debug-badge.spg-debug-badge" -Label "styles.css"
Require-Text -Text $styles -Needle "#safe-prompt-guard-warning.spg-warning" -Label "styles.css"
Require-Text -Text $styles -Needle "#safe-prompt-guard-selection.spg-selection" -Label "styles.css"
Require-Text -Text $styles -Needle ".spg-manualEntry" -Label "styles.css"
Require-Text -Text $styles -Needle ".spg-button--manual-open" -Label "styles.css"
Require-Text -Text $popup -Needle "openLearnedDb" -Label "popup.js"
Require-Text -Text $popup -Needle 'chrome.runtime.getURL("db.html")' -Label "popup.js"
Require-Text -Text $popup -Needle "addLearnedManual" -Label "popup.js"
Require-Text -Text $popup -Needle "safe-prompt-request-selection-candidate" -Label "popup.js"
Require-Text -Text $popupHtml -Needle 'href="popup.css"' -Label "popup.html"
Require-Text -Text $popupHtml -Needle "Open DB" -Label "popup.html"
Require-Text -Text $popupCss -Needle "grid-template-columns: repeat(3, minmax(0, 1fr));" -Label "popup.css"
Require-Text -Text $popupCss -Needle "width: 448px;" -Label "popup.css"
Require-Text -Text $dbHtml -Needle "Delete selected" -Label "db.html"
Require-Text -Text $dbHtml -Needle "Export JSON" -Label "db.html"
Require-Text -Text $dbHtml -Needle "Export CSV" -Label "db.html"
Require-Text -Text $dbJs -Needle "safe-prompt-learned-update" -Label "db.js"
Require-Text -Text $dbJs -Needle "safe-prompt-learned-remove-many" -Label "db.js"
Require-Text -Text $dbJs -Needle "safe-prompt-learned-import" -Label "db.js"
Require-Text -Text $dbJs -Needle "Import learned values" -Label "db.js"
Require-Text -Text $dbJs -Needle "parseCsvImport" -Label "db.js"
Require-Text -Text $dbCss -Needle ".drawer" -Label "db.css"
Require-Text -Text $dbCss -Needle ".dbTable" -Label "db.css"
Forbid-Text -Text $content -Needle 'buildButton("Replace"' -Label "content.js"
Forbid-Text -Text $styles -Needle ".spg-button--replace" -Label "styles.css"

if ($errors.Count -gt 0) {
  Write-Host "Post-change smoke gate: FAIL" -ForegroundColor Red
  $errors | ForEach-Object { Write-Host "FAIL: $_" -ForegroundColor Red }
  Write-Host ""
  Write-Host "Manual ChatGPT smoke path still required:" -ForegroundColor Yellow
  Write-Host "1. Reload the unpacked extension."
  Write-Host "2. Open https://chatgpt.com/."
  Write-Host "3. Paste Password=ProjectRedPass!2026."
  Write-Host "4. Confirm the page badge shows Loaded and Editor found."
  Write-Host "5. Confirm the inline warning appears near the send area."
  exit 1
}

$notes.Add("Static gate passed.")
$notes.Add("Manifest includes all supported domains, including chatgpt.com.")
$notes.Add("Manifest icon set is present for Chrome Web Store packaging.")
$notes.Add("content.js still contains required ChatGPT hooks, debug logs, and inline-warning path.")
$notes.Add("styles.css still contains debug badge, inline warning, and manual-add form styles.")
$notes.Add("Popup now exposes the widened Local DB action row and the full DB page.")
$notes.Add("Interactive DB page files and store asset package are present.")

if (-not $SkipDetectorTests) {
  Require-File -Path $detectorRunnerPath
  if ($errors.Count -gt 0) {
    Write-Host "Post-change smoke gate: FAIL" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "FAIL: $_" -ForegroundColor Red }
    exit 1
  }

  Write-Host "Running detector regression harness..." -ForegroundColor Cyan
  powershell -NoProfile -ExecutionPolicy Bypass -File $detectorRunnerPath
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Post-change smoke gate: FAIL" -ForegroundColor Red
    Write-Host "FAIL: Detector regression harness reported failures." -ForegroundColor Red
    exit $LASTEXITCODE
  }
  $notes.Add("Detector regression harness passed.")
}

Write-Host "Post-change smoke gate: PASS" -ForegroundColor Green
$notes | ForEach-Object { Write-Host "OK: $_" -ForegroundColor Green }
Write-Host ""
Write-Host "Manual ChatGPT smoke path to run after this script:" -ForegroundColor Yellow
Write-Host "1. Reload the unpacked extension."
Write-Host "2. Open https://chatgpt.com/."
Write-Host "3. Paste Password=ProjectRedPass!2026."
Write-Host "4. Confirm the debug badge shows Loaded: Yes and Editor: Found."
Write-Host "5. Confirm the inline warning appears before send."
Write-Host "6. Click Send and confirm the warning is still enforced."
