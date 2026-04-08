$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$harnessPath = "C:\ChromeExtension\apps\SafePrompt-Guard\detector-test-harness.html"
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"

if (-not (Test-Path -LiteralPath $edgePath)) {
  throw "Microsoft Edge was not found at $edgePath"
}

if (-not (Test-Path -LiteralPath $harnessPath)) {
  throw "Harness file was not found at $harnessPath"
}

$uri = "file:///" + ($harnessPath -replace "\\", "/")
$userDataDir = Join-Path "C:\ChromeExtension" ("tmp-edge-profile-detector-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $userDataDir -Force | Out-Null

try {
  function Invoke-HarnessDump {
    $stdoutPath = Join-Path "C:\ChromeExtension" ("tmp-detector-stdout-" + [guid]::NewGuid().ToString("N") + ".txt")
    $stderrPath = Join-Path "C:\ChromeExtension" ("tmp-detector-stderr-" + [guid]::NewGuid().ToString("N") + ".txt")
    try {
      $process = Start-Process -FilePath $edgePath -ArgumentList @(
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--user-data-dir=$userDataDir",
        "--allow-file-access-from-files",
        "--virtual-time-budget=12000",
        "--dump-dom",
        $uri
      ) -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -Wait

      if (-not (Test-Path -LiteralPath $stdoutPath)) {
        return ""
      }

      return Get-Content -LiteralPath $stdoutPath -Raw
    }
    finally {
      if (Test-Path -LiteralPath $stdoutPath) {
        Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue
      }
      if (Test-Path -LiteralPath $stderrPath) {
        Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
      }
    }
  }

  $text = Invoke-HarnessDump
  $match = [regex]::Match($text, '<pre id="results">([\s\S]*?)</pre>')
  if (-not $match.Success) {
    Start-Sleep -Milliseconds 750
    $text = Invoke-HarnessDump
    $match = [regex]::Match($text, '<pre id="results">([\s\S]*?)</pre>')
  }
  if (-not $match.Success) {
    throw "Could not read detector harness output."
  }

  $json = $match.Groups[1].Value
  $decoded = [System.Net.WebUtility]::HtmlDecode($json)
  $result = $decoded | ConvertFrom-Json

  "Detector harness summary:"
  "Built-in: $($result.summary.builtInPassed)/$($result.summary.builtInTotal) passed"
  "Custom:   $($result.summary.customPassed)/$($result.summary.customTotal) passed"
  "Store:    $($result.summary.storePassed)/$($result.summary.storeTotal) passed"

  if ($result.summary.failedBuiltIn.Count -gt 0) {
    ""
    "Failed built-in cases:"
    $result.summary.failedBuiltIn | ConvertTo-Json -Depth 6
  }

  if ($result.summary.failedCustom.Count -gt 0) {
    ""
    "Failed custom cases:"
    $result.summary.failedCustom | ConvertTo-Json -Depth 6
  }

  if ($result.summary.failedStore.Count -gt 0) {
    ""
    "Failed store cases:"
    $result.summary.failedStore | ConvertTo-Json -Depth 6
  }

  if (($result.summary.failedBuiltIn.Count + $result.summary.failedCustom.Count + $result.summary.failedStore.Count) -gt 0) {
    exit 1
  }
}
finally {
  $ErrorActionPreference = $previousErrorActionPreference
  if (Test-Path -LiteralPath $userDataDir) {
    Remove-Item -LiteralPath $userDataDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
