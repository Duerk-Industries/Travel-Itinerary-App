$ErrorActionPreference = 'Stop'

function Assert-GitHubActor([bool]$DryRun) {
  if ($DryRun) { return }
  $actor = $env:GITHUB_ACTOR
  if ([string]::IsNullOrWhiteSpace($actor)) {
    Write-Error "ERROR: GITHUB_ACTOR is required; run production-affecting scripts through workflow_dispatch."
    exit 1
  }
  $allowed = @('Bryan', 'bryan', 'Tristan', 'tristan')
  if ($allowed -notcontains $actor) {
    Write-Error "ERROR: GitHub actor '$actor' is not authorized for production deploy operations."
    exit 1
  }
}
