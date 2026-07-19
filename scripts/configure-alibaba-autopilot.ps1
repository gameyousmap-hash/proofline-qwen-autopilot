param(
  [Parameter(Mandatory = $true)]
  [string]$FunctionUrl,
  [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"

if (-not $EnvFile) {
  $EnvFile = Join-Path (Split-Path -Parent $PSScriptRoot) ".env.local"
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Environment file not found: $EnvFile"
}

$parsedUrl = $null
if (-not [Uri]::TryCreate($FunctionUrl, [UriKind]::Absolute, [ref]$parsedUrl) -or
    $parsedUrl.Scheme -ne "https" -or
    -not $parsedUrl.Host.EndsWith(".fcapp.run")) {
  throw "FunctionUrl must be an HTTPS fcapp.run URL."
}

$secretBytes = New-Object byte[] 32
$randomNumberGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $randomNumberGenerator.GetBytes($secretBytes)
}
finally {
  $randomNumberGenerator.Dispose()
}
$serviceSecret = [Convert]::ToBase64String($secretBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$values = [ordered]@{
  ALIBABA_AUTOPILOT_URL = $parsedUrl.AbsoluteUri.TrimEnd('/')
  ALIBABA_AUTOPILOT_SECRET = $serviceSecret
  PROOFLINE_SERVICE_SECRET = $serviceSecret
}

$lines = @(Get-Content -LiteralPath $EnvFile -Encoding UTF8)
foreach ($key in $values.Keys) {
  $replacement = "$key=$($values[$key])"
  $found = $false
  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match "^$([regex]::Escape($key))=") {
      $lines[$index] = $replacement
      $found = $true
      break
    }
  }
  if (-not $found) {
    $lines += $replacement
  }
}

Set-Content -LiteralPath $EnvFile -Value $lines -Encoding UTF8
Write-Host "Alibaba Function Compute URL and service secret were configured without printing credentials."
