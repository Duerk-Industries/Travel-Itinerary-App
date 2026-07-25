param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [Parameter(Mandatory = $true)][string]$Environment
)

$ErrorActionPreference = 'Stop'

$healthUrl = "$($BaseUrl.TrimEnd('/'))/api/healthz"
try {
  $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -Method Get
  $status = $response.StatusCode
} catch {
  if ($_.Exception.Response) {
    $status = [int]$_.Exception.Response.StatusCode
  } else {
    Write-Error "ERROR: health check failed at $healthUrl : $($_.Exception.Message)"
    exit 1
  }
}

if ($status -ne 200) {
  Write-Error "ERROR: health check failed at $healthUrl status=$status"
  exit 1
}

Write-Host "Smoke test passed for $Environment at $BaseUrl"
