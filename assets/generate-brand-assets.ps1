<#
  What this file does:
  Generates the raster icon set and Chrome Web Store marketing assets for SafePrompt Guard.

  Why it exists:
  The extension now has a visual system and store package, so it needs reproducible brand outputs rather than one-off exported files.

  How to extend it:
  Add alternate themes, animated frame exports, or refreshed listing shots if the product branding evolves.
#>

param(
  [string]$ExtensionRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$brandRoot = Join-Path $ExtensionRoot "assets\brand"
$iconRoot = Join-Path $brandRoot "icons"
$storeRoot = Join-Path $ExtensionRoot "assets\store"
$screenshotRoot = Join-Path $storeRoot "screenshots"

foreach ($path in @($brandRoot, $iconRoot, $storeRoot, $screenshotRoot)) {
  New-Item -ItemType Directory -Path $path -Force | Out-Null
}

function Get-Color([string]$hex, [int]$alpha = 255) {
  $color = [System.Drawing.ColorTranslator]::FromHtml($hex)
  return [System.Drawing.Color]::FromArgb($alpha, $color.R, $color.G, $color.B)
}

function New-Canvas([int]$width, [int]$height) {
  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  return @{
    Bitmap = $bitmap
    Graphics = $graphics
    Width = $width
    Height = $height
  }
}

function Save-Canvas($canvas, [string]$path) {
  $canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Graphics.Dispose()
  $canvas.Bitmap.Dispose()
}

function New-RoundRectPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = [Math]::Max(1, $radius * 2)
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Fill-RoundRect($graphics, $brush, [float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = New-RoundRectPath $x $y $width $height $radius
  $graphics.FillPath($brush, $path)
  $path.Dispose()
}

function Draw-RoundRect($graphics, $pen, [float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = New-RoundRectPath $x $y $width $height $radius
  $graphics.DrawPath($pen, $path)
  $path.Dispose()
}

function Draw-StringLine($graphics, [string]$text, [string]$fontName, [float]$size, $style, $brush, [float]$x, [float]$y) {
  $font = New-Object System.Drawing.Font($fontName, $size, $style)
  $graphics.DrawString($text, $font, $brush, $x, $y)
  $font.Dispose()
}

function Fill-Background($graphics, [int]$width, [int]$height) {
  $rect = New-Object System.Drawing.RectangleF 0, 0, $width, $height
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, (Get-Color "#0B1728"), (Get-Color "#050B14"), 90
  $graphics.FillRectangle($brush, $rect)
  $brush.Dispose()

  $glowBrush = New-Object System.Drawing.SolidBrush (Get-Color "#4DC6FF" 28)
  $graphics.FillEllipse($glowBrush, $width * 0.68, -$height * 0.06, $width * 0.28, $height * 0.32)
  $graphics.FillEllipse($glowBrush, -$width * 0.06, $height * 0.64, $width * 0.22, $height * 0.24)
  $glowBrush.Dispose()
}

function Draw-BrandMark($graphics, [float]$x, [float]$y, [float]$size) {
  $rect = New-Object System.Drawing.RectangleF -ArgumentList $x, $y, $size, $size
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, (Get-Color "#12395C"), (Get-Color "#07111F"), 90
  Fill-RoundRect $graphics $bgBrush $x $y $size $size ($size * 0.22)
  $bgBrush.Dispose()

  $highlightBrush = New-Object System.Drawing.SolidBrush (Get-Color "#F3AA34" 30)
  $graphics.FillEllipse($highlightBrush, $x + $size * 0.66, $y + $size * 0.10, $size * 0.18, $size * 0.18)
  $highlightBrush.Dispose()

  $shieldPen = New-Object System.Drawing.Pen((Get-Color "#4DC6FF"), [Math]::Max(2, $size * 0.045))
  $shieldPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $shield = New-Object System.Drawing.Drawing2D.GraphicsPath
  $shield.AddLines(@(
    (New-Object System.Drawing.PointF -ArgumentList ($x + $size * 0.5), ($y + $size * 0.16)),
    (New-Object System.Drawing.PointF -ArgumentList ($x + $size * 0.72), ($y + $size * 0.25)),
    (New-Object System.Drawing.PointF -ArgumentList ($x + $size * 0.72), ($y + $size * 0.49)),
    (New-Object System.Drawing.PointF -ArgumentList ($x + $size * 0.5), ($y + $size * 0.70)),
    (New-Object System.Drawing.PointF -ArgumentList ($x + $size * 0.28), ($y + $size * 0.49)),
    (New-Object System.Drawing.PointF -ArgumentList ($x + $size * 0.28), ($y + $size * 0.25)),
    (New-Object System.Drawing.PointF -ArgumentList ($x + $size * 0.5), ($y + $size * 0.16))
  ))
  $graphics.DrawPath($shieldPen, $shield)
  $shield.Dispose()
  $shieldPen.Dispose()

  $bubbleBrush = New-Object System.Drawing.SolidBrush (Get-Color "#EEF4FF" 30)
  $bubblePen = New-Object System.Drawing.Pen((Get-Color "#B7EBFF"), [Math]::Max(2, $size * 0.03))
  $bubbleX = $x + $size * 0.34
  $bubbleY = $y + $size * 0.31
  $bubbleW = $size * 0.34
  $bubbleH = $size * 0.22
  Fill-RoundRect $graphics $bubbleBrush $bubbleX $bubbleY $bubbleW $bubbleH ($size * 0.06)
  Draw-RoundRect $graphics $bubblePen $bubbleX $bubbleY $bubbleW $bubbleH ($size * 0.06)
  $tail = New-Object System.Drawing.Drawing2D.GraphicsPath
  $tail.AddPolygon(@(
    (New-Object System.Drawing.PointF -ArgumentList ($bubbleX + $bubbleW * 0.36), ($bubbleY + $bubbleH)),
    (New-Object System.Drawing.PointF -ArgumentList ($bubbleX + $bubbleW * 0.27), ($bubbleY + $bubbleH + $size * 0.08)),
    (New-Object System.Drawing.PointF -ArgumentList ($bubbleX + $bubbleW * 0.5), ($bubbleY + $bubbleH))
  ))
  $graphics.FillPath($bubbleBrush, $tail)
  $graphics.DrawPath($bubblePen, $tail)
  $tail.Dispose()
  $bubblePen.Dispose()
  $bubbleBrush.Dispose()

  $scanPen = New-Object System.Drawing.Pen((Get-Color "#4DC6FF"), [Math]::Max(2, $size * 0.025))
  $scanPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $scanPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $graphics.DrawLine($scanPen, $x + $size * 0.40, $y + $size * 0.40, $x + $size * 0.60, $y + $size * 0.40)
  $scanPen.Color = Get-Color "#F3AA34"
  $graphics.DrawLine($scanPen, $x + $size * 0.40, $y + $size * 0.48, $x + $size * 0.54, $y + $size * 0.48)
  $scanPen.Dispose()
}

function Draw-Button($graphics, [float]$x, [float]$y, [float]$width, [float]$height, [string]$label, [string]$fillHex, [string]$textHex) {
  $brush = New-Object System.Drawing.SolidBrush (Get-Color $fillHex)
  Fill-RoundRect $graphics $brush $x $y $width $height ($height / 2)
  $brush.Dispose()
  $textBrush = New-Object System.Drawing.SolidBrush (Get-Color $textHex)
  Draw-StringLine $graphics $label "Segoe UI Semibold" 12 ([System.Drawing.FontStyle]::Bold) $textBrush ($x + 14) ($y + 8)
  $textBrush.Dispose()
}

function Draw-Card($graphics, [float]$x, [float]$y, [float]$width, [float]$height, [string]$fillHex, [int]$alpha = 235) {
  $brush = New-Object System.Drawing.SolidBrush (Get-Color $fillHex $alpha)
  Fill-RoundRect $graphics $brush $x $y $width $height 22
  $brush.Dispose()
  $pen = New-Object System.Drawing.Pen((Get-Color "#5F7CA8" 55), 1.4)
  Draw-RoundRect $graphics $pen $x $y $width $height 22
  $pen.Dispose()
}

function Draw-WindowMock($graphics, [float]$x, [float]$y, [float]$width, [float]$height) {
  Draw-Card $graphics $x $y $width $height "#0B1627" 235
  $topBrush = New-Object System.Drawing.SolidBrush (Get-Color "#13253E" 255)
  Fill-RoundRect $graphics $topBrush $x $y $width 56 22
  $topBrush.Dispose()
  $dotBrush = New-Object System.Drawing.SolidBrush (Get-Color "#F3AA34")
  $graphics.FillEllipse($dotBrush, $x + 20, $y + 20, 10, 10)
  $graphics.FillEllipse($dotBrush, $x + 38, $y + 20, 10, 10)
  $graphics.FillEllipse($dotBrush, $x + 56, $y + 20, 10, 10)
  $dotBrush.Dispose()
}

function Draw-WarningMock($graphics, [float]$x, [float]$y) {
  Draw-Card $graphics $x $y 324 250 "#0C1730" 250
  $titleBrush = New-Object System.Drawing.SolidBrush (Get-Color "#EEF4FF")
  $mutedBrush = New-Object System.Drawing.SolidBrush (Get-Color "#96A8C8")
  $alertBrush = New-Object System.Drawing.SolidBrush (Get-Color "#F8C8C4")
  Draw-StringLine $graphics "Sensitive content detected" "Segoe UI Semibold" 14 ([System.Drawing.FontStyle]::Bold) $titleBrush ($x + 16) ($y + 16)
  Draw-StringLine $graphics "1 password, 1 token" "Segoe UI" 12 ([System.Drawing.FontStyle]::Regular) $alertBrush ($x + 16) ($y + 46)
  foreach ($i in 0..1) {
    $itemY = $y + 74 + ($i * 72)
    Draw-Card $graphics ($x + 14) $itemY 296 60 "#10233F" 230
    Draw-StringLine $graphics ($(if ($i -eq 0) { "Password: Demo...26" } else { "Token: wh_12...def" })) "Segoe UI Semibold" 12 ([System.Drawing.FontStyle]::Bold) $titleBrush ($x + 26) ($itemY + 12)
    Draw-StringLine $graphics ($(if ($i -eq 0) { "Mask: ********" } else { "Mask: [MASKED_TOKEN]" })) "Segoe UI" 11 ([System.Drawing.FontStyle]::Regular) $mutedBrush ($x + 26) ($itemY + 34)
  }
  Draw-Button $graphics ($x + 16) ($y + 208) 64 34 "Cancel" "#EEF4FF" "#07111F"
  Draw-Button $graphics ($x + 90) ($y + 208) 58 34 "Mask" "#F3AA34" "#2C1A00"
  Draw-Button $graphics ($x + 158) ($y + 208) 102 34 "Add manually" "#4DC6FF" "#0B3448"
  Draw-Button $graphics ($x + 268) ($y + 208) 42 34 "Send" "#DA3C33" "#FFFFFF"
  $titleBrush.Dispose()
  $mutedBrush.Dispose()
  $alertBrush.Dispose()
}

function Draw-ConsoleMock($graphics, [float]$x, [float]$y, [float]$width, [float]$height) {
  Draw-Card $graphics $x $y $width $height "#0C1730" 245
  Draw-Card $graphics ($x + 16) ($y + 16) ($width - 32) 84 "#0F223B" 255
  $brush = New-Object System.Drawing.SolidBrush (Get-Color "#EEF4FF")
  $muted = New-Object System.Drawing.SolidBrush (Get-Color "#96A8C8")
  Draw-StringLine $graphics "Local DB Console" "Segoe UI Semibold" 16 ([System.Drawing.FontStyle]::Bold) $brush ($x + 30) ($y + 28)
  Draw-StringLine $graphics "Search, filter, import, edit, and export exact-match learned values." "Segoe UI" 11 ([System.Drawing.FontStyle]::Regular) $muted ($x + 30) ($y + 54)
  Draw-Button $graphics ($x + $width - 420) ($y + 28) 64 34 "Add" "#4DC6FF" "#0B3448"
  Draw-Button $graphics ($x + $width - 346) ($y + 28) 76 34 "Import" "#F3AA34" "#2C1A00"
  Draw-Button $graphics ($x + $width - 260) ($y + 28) 90 34 "Export" "#EEF4FF" "#07111F"
  Draw-Button $graphics ($x + $width - 160) ($y + 28) 124 34 "Delete selected" "#DA3C33" "#FFFFFF"

  $headerY = $y + 122
  $rowWidth = $width - 32
  Draw-Card $graphics ($x + 16) $headerY $rowWidth 48 "#0F223B" 255
  $headers = @("Type", "Raw value", "Created", "Updated", "Actions")
  $headerXs = @(($x + 42), ($x + 140), ($x + 540), ($x + 680), ($x + 820))
  for ($i = 0; $i -lt $headers.Count; $i++) {
    Draw-StringLine $graphics $headers[$i] "Segoe UI Semibold" 10 ([System.Drawing.FontStyle]::Bold) $muted $headerXs[$i] ($headerY + 16)
  }

  for ($row = 0; $row -lt 4; $row++) {
    $rowY = $headerY + 56 + ($row * 64)
    Draw-Card $graphics ($x + 16) $rowY $rowWidth 52 "#091525" 245
    Draw-StringLine $graphics ($(if ($row % 2 -eq 0) { "Password" } else { "Token" })) "Segoe UI Semibold" 11 ([System.Drawing.FontStyle]::Bold) $brush ($x + 42) ($rowY + 16)
    Draw-StringLine $graphics ($(if ($row % 2 -eq 0) { "DemoAccess2026" } else { "wh_123456789abcdef" })) "Consolas" 11 ([System.Drawing.FontStyle]::Regular) $brush ($x + 140) ($rowY + 16)
    Draw-StringLine $graphics "4/7/2026" "Segoe UI" 10 ([System.Drawing.FontStyle]::Regular) $muted ($x + 540) ($rowY + 18)
    Draw-StringLine $graphics "4/7/2026" "Segoe UI" 10 ([System.Drawing.FontStyle]::Regular) $muted ($x + 680) ($rowY + 18)
    Draw-Button $graphics ($x + 820) ($rowY + 10) 54 30 "Edit" "#4DC6FF" "#0B3448"
    Draw-Button $graphics ($x + 882) ($rowY + 10) 58 30 "Delete" "#DA3C33" "#FFFFFF"
  }

  Draw-Card $graphics ($x + $width - 286) ($y + 114) 250 316 "#091423" 252
  Draw-StringLine $graphics "Edit learned value" "Segoe UI Semibold" 14 ([System.Drawing.FontStyle]::Bold) $brush ($x + $width - 264) ($y + 132)
  Draw-StringLine $graphics "Type" "Segoe UI Semibold" 10 ([System.Drawing.FontStyle]::Bold) $muted ($x + $width - 264) ($y + 168)
  Draw-Card $graphics ($x + $width - 264) ($y + 184) 206 36 "#0E223D" 255
  Draw-StringLine $graphics "Password" "Segoe UI" 11 ([System.Drawing.FontStyle]::Regular) $brush ($x + $width - 248) ($y + 195)
  Draw-StringLine $graphics "Raw value" "Segoe UI Semibold" 10 ([System.Drawing.FontStyle]::Bold) $muted ($x + $width - 264) ($y + 232)
  Draw-Card $graphics ($x + $width - 264) ($y + 248) 206 120 "#0E223D" 255
  Draw-StringLine $graphics "DemoAccess2026" "Consolas" 11 ([System.Drawing.FontStyle]::Regular) $brush ($x + $width - 248) ($y + 266)
  Draw-Button $graphics ($x + $width - 188) ($y + 386) 58 32 "Cancel" "#EEF4FF" "#07111F"
  Draw-Button $graphics ($x + $width - 122) ($y + 386) 64 32 "Save" "#4DC6FF" "#0B3448"
  $brush.Dispose()
  $muted.Dispose()
}

function Draw-ScreenshotBase($graphics, [int]$width, [int]$height, [string]$title, [string]$subtitle) {
  Fill-Background $graphics $width $height
  Draw-BrandMark $graphics 68 60 92
  $titleBrush = New-Object System.Drawing.SolidBrush (Get-Color "#EEF4FF")
  $mutedBrush = New-Object System.Drawing.SolidBrush (Get-Color "#96A8C8")
  Draw-StringLine $graphics "SafePrompt Guard" "Segoe UI Semibold" 20 ([System.Drawing.FontStyle]::Bold) $titleBrush 182 70
  Draw-StringLine $graphics $title "Segoe UI Semibold" 30 ([System.Drawing.FontStyle]::Bold) $titleBrush 68 182
  Draw-StringLine $graphics $subtitle "Segoe UI" 15 ([System.Drawing.FontStyle]::Regular) $mutedBrush 68 228
  $titleBrush.Dispose()
  $mutedBrush.Dispose()
}

function New-Screenshot([string]$path, [string]$title, [string]$subtitle, [scriptblock]$drawContent) {
  $canvas = New-Canvas 1280 800
  $graphics = $canvas.Graphics
  Draw-ScreenshotBase $graphics 1280 800 $title $subtitle
  & $drawContent $graphics
  Save-Canvas $canvas $path
}

function New-PromoTile([string]$path, [int]$width, [int]$height, [string]$headline, [string]$subhead) {
  $canvas = New-Canvas $width $height
  $graphics = $canvas.Graphics
  Fill-Background $graphics $width $height
  Draw-BrandMark $graphics ($width * 0.08) ($height * 0.18) ([Math]::Min($width, $height) * 0.28)
  $titleBrush = New-Object System.Drawing.SolidBrush (Get-Color "#EEF4FF")
  $mutedBrush = New-Object System.Drawing.SolidBrush (Get-Color "#96A8C8")
  Draw-StringLine $graphics $headline "Segoe UI Semibold" ([Math]::Max(18, $width / 15)) ([System.Drawing.FontStyle]::Bold) $titleBrush ($width * 0.42) ($height * 0.22)
  Draw-StringLine $graphics $subhead "Segoe UI" ([Math]::Max(10, $width / 30)) ([System.Drawing.FontStyle]::Regular) $mutedBrush ($width * 0.42) ($height * 0.48)
  $titleBrush.Dispose()
  $mutedBrush.Dispose()
  Save-Canvas $canvas $path
}

function New-Icon([string]$path, [int]$size) {
  $canvas = New-Canvas $size $size
  Draw-BrandMark $canvas.Graphics 0 0 $size
  Save-Canvas $canvas $path
}

New-Icon (Join-Path $iconRoot "icon-16.png") 16
New-Icon (Join-Path $iconRoot "icon-32.png") 32
New-Icon (Join-Path $iconRoot "icon-48.png") 48
New-Icon (Join-Path $iconRoot "icon-128.png") 128
New-Icon (Join-Path $iconRoot "icon-256.png") 256

New-Screenshot (Join-Path $screenshotRoot "screenshot-01-warning.png") `
  "Block secrets before send" `
  "Compact inline warning cards highlight passwords, tokens, and internal-only values before they leave the browser." `
  {
    param($g)
    Draw-WindowMock $g 68 286 1144 430
    Draw-Card $g 116 358 650 250 "#111E33" 220
    $brush = New-Object System.Drawing.SolidBrush (Get-Color "#EEF4FF")
    $muted = New-Object System.Drawing.SolidBrush (Get-Color "#96A8C8")
    Draw-StringLine $g "Project: DemoSales" "Segoe UI" 16 ([System.Drawing.FontStyle]::Regular) $brush 150 386
    Draw-StringLine $g "Password: DemoAccess2026" "Consolas" 16 ([System.Drawing.FontStyle]::Regular) $brush 150 438
    Draw-StringLine $g "webhook_token=wh_123456789abcdef" "Consolas" 16 ([System.Drawing.FontStyle]::Regular) $brush 150 476
    Draw-StringLine $g "The warning stays next to the composer instead of hiding in the toolbar." "Segoe UI" 14 ([System.Drawing.FontStyle]::Regular) $muted 150 560
    $brush.Dispose()
    $muted.Dispose()
    Draw-WarningMock $g 828 348
  }

New-Screenshot (Join-Path $screenshotRoot "screenshot-02-mask-and-review.png") `
  "Review and mask specific findings" `
  "Selectable finding rows and one-click masking keep the prompt readable while removing only the risky values." `
  {
    param($g)
    Draw-WindowMock $g 68 286 1144 430
    Draw-Card $g 116 358 650 250 "#111E33" 220
    $brush = New-Object System.Drawing.SolidBrush (Get-Color "#EEF4FF")
    $accent = New-Object System.Drawing.SolidBrush (Get-Color "#F3AA34")
    Draw-StringLine $g "REDIS_PASSWORD=RedisSecure!789" "Consolas" 16 ([System.Drawing.FontStyle]::Regular) $brush 150 438
    $graphicsPen = New-Object System.Drawing.Pen((Get-Color "#F3AA34"), 4)
    $g.DrawRectangle($graphicsPen, 144, 430, 340, 30)
    $graphicsPen.Dispose()
    Draw-StringLine $g "Highlight a finding, jump to it, then mask just that value." "Segoe UI" 14 ([System.Drawing.FontStyle]::Regular) $accent 150 560
    $brush.Dispose()
    $accent.Dispose()
    Draw-WarningMock $g 828 332
  }

New-Screenshot (Join-Path $screenshotRoot "screenshot-03-local-db-console.png") `
  "Manage the Local DB like an admin console" `
  "Search, filter, sort, bulk-delete, and edit exact-match values from one desktop-first management surface." `
  {
    param($g)
    Draw-ConsoleMock $g 68 282 1144 444
  }

New-Screenshot (Join-Path $screenshotRoot "screenshot-04-import-export.png") `
  "Import and export exact-match rules" `
  "Preview merge or replace operations before applying them, then export the filtered table to JSON or CSV." `
  {
    param($g)
    Draw-ConsoleMock $g 68 282 1144 444
    Draw-Card $g 906 396 252 280 "#091423" 252
    $brush = New-Object System.Drawing.SolidBrush (Get-Color "#EEF4FF")
    $muted = New-Object System.Drawing.SolidBrush (Get-Color "#96A8C8")
    Draw-StringLine $g "Import learned values" "Segoe UI Semibold" 14 ([System.Drawing.FontStyle]::Bold) $brush 930 416
    Draw-StringLine $g "demo-import.csv" "Segoe UI" 11 ([System.Drawing.FontStyle]::Regular) $muted 930 448
    foreach ($i in 0..3) {
      $boxY = 474 + ($i * 44)
      Draw-Card $g 928 $boxY 208 34 "#0F223B" 255
      $labels = @("Rows parsed 18", "Valid rows 16", "Would add 9", "Would update 7")
      Draw-StringLine $g $labels[$i] "Segoe UI" 11 ([System.Drawing.FontStyle]::Regular) $brush 944 ($boxY + 9)
    }
    Draw-Button $g 988 650 62 32 "Cancel" "#EEF4FF" "#07111F"
    Draw-Button $g 1058 650 78 32 "Import" "#4DC6FF" "#0B3448"
    $brush.Dispose()
    $muted.Dispose()
  }

New-Screenshot (Join-Path $screenshotRoot "screenshot-05-local-first.png") `
  "Keep sensitive knowledge local-first" `
  "The popup stays compact, the page warning stays focused, and the Local DB never needs a backend to stay useful." `
  {
    param($g)
    Draw-Card $g 90 302 420 316 "#0C1730" 248
    Draw-BrandMark $g 122 334 56
    $brush = New-Object System.Drawing.SolidBrush (Get-Color "#EEF4FF")
    $muted = New-Object System.Drawing.SolidBrush (Get-Color "#96A8C8")
    Draw-StringLine $g "Toolbar popup" "Segoe UI Semibold" 16 ([System.Drawing.FontStyle]::Bold) $brush 198 340
    Draw-StringLine $g "Manual add, masked previews, and quick Local DB access." "Segoe UI" 12 ([System.Drawing.FontStyle]::Regular) $muted 198 370
    foreach ($i in 0..2) {
      Draw-Card $g 118 (420 + ($i * 52)) 364 40 "#0F223B" 255
    }
    Draw-Button $g 118 580 106 34 "Add manually" "#4DC6FF" "#0B3448"
    Draw-Button $g 234 580 86 34 "Open DB" "#EEF4FF" "#07111F"
    Draw-Button $g 330 580 90 34 "Clear all" "#DA3C33" "#FFFFFF"
    $brush.Dispose()
    $muted.Dispose()
    Draw-WarningMock $g 548 334
  }

New-PromoTile (Join-Path $storeRoot "small-promo-440x280.png") 440 280 "Guard prompts locally" "Catch passwords, tokens, and internal references before send."
New-PromoTile (Join-Path $storeRoot "marquee-1400x560.png") 1400 560 "SafePrompt Guard" "Modern local prompt security for AI tools and internal workflows."
New-PromoTile (Join-Path $storeRoot "video-thumbnail-1280x720.png") 1280 720 "See the flow in 30 seconds" "Detect, review, mask, and manage your Local DB without leaving the browser."

Write-Host "Generated SafePrompt Guard brand and store assets:" -ForegroundColor Green
Write-Host "  Icons:       $iconRoot"
Write-Host "  Screenshots: $screenshotRoot"
Write-Host "  Promo:       $storeRoot"
