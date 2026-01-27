param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ProjectId
)

$ErrorActionPreference = 'Stop'

Write-Host "Logging into gcloud..."
& gcloud auth login

Write-Host "Setting default project to '$ProjectId'..."
& gcloud config set project $ProjectId

Write-Host "gcloud configured successfully."
