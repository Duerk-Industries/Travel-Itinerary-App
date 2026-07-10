$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\deploy-common.ps1')
Import-DeployConfig
Assert-RequiredVars @('TEST_SERVICE_NAME', 'TEST_REGION', 'PROD_SERVICE_NAME', 'PROD_REGION')

function Show-ServiceState([string]$Label, [string]$Service, [string]$Region) {
  Write-Host "== $Label =="
  & gcloud run services describe $Service --region $Region `
    --format='table(status.latestReadyRevisionName,spec.template.spec.containers[0].image,metadata.labels.app-git-sha,status.traffic[].revisionName,status.traffic[].percent,status.url)'
}

Show-ServiceState -Label 'test' -Service $env:TEST_SERVICE_NAME -Region $env:TEST_REGION
Show-ServiceState -Label 'production' -Service $env:PROD_SERVICE_NAME -Region $env:PROD_REGION
