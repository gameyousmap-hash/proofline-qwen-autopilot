param(
  [string]$EnvFile = (Join-Path (Split-Path -Parent $PSScriptRoot) ".env.local"),
  [string]$Access = "default"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$functionRoot = Join-Path $repoRoot "alibaba-cloud\function-compute"
$requiredKeys = @(
  "QWEN_BASE_URL",
  "QWEN_API_KEY",
  "QWEN_MODEL",
  "PROOFLINE_SERVICE_SECRET"
)

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Environment file not found: $EnvFile"
}

foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding UTF8) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
    continue
  }

  $parts = $trimmed.Split("=", 2)
  $key = $parts[0].Trim()
  if ($requiredKeys -notcontains $key) {
    continue
  }

  $value = $parts[1].Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  Set-Item -LiteralPath "Env:$key" -Value $value
}

$missing = @($requiredKeys | Where-Object {
  -not (Get-Item -LiteralPath "Env:$_" -ErrorAction SilentlyContinue).Value
})
if ($missing.Count -gt 0) {
  throw "Missing required environment values: $($missing -join ', ')"
}

$serverlessCommand = Get-Command s.cmd -ErrorAction SilentlyContinue
$serverlessPath = if ($serverlessCommand) { $serverlessCommand.Source } else { $null }
if (-not $serverlessPath) {
  $npmPrefix = (& npm.cmd config get prefix).Trim()
  $candidate = Join-Path $npmPrefix "s.cmd"
  if (Test-Path -LiteralPath $candidate) {
    $serverlessPath = $candidate
  }
}
if (-not $serverlessPath) {
  throw "Serverless Devs CLI was not found. Install it with: npm install -g @serverless-devs/s"
}

Write-Host "Deploying Proofline analysis to Alibaba Cloud Function Compute (ap-southeast-1)..."
Push-Location $functionRoot
try {
  & $serverlessPath -a $Access deploy -y
  if ($LASTEXITCODE -ne 0) {
    throw "Serverless Devs deployment failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}
