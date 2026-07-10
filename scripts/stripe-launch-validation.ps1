param(
  [string]$StripeApiKey = $env:STRIPE_SECRET_KEY,
  [string]$BackendUrl = '',
  [string]$AdminToken = '',
  [string]$UserId = '',
  [string]$Email = '',
  [string]$SchedulerRegion = 'us-east4',
  [string]$SchedulerJobName = 'billing-reconcile',
  [switch]$SkipTests,
  [switch]$SkipStripeCli,
  [switch]$SkipCloudScheduler,
  [switch]$RunCloudScheduler,
  [switch]$RunTestClock,
  [switch]$RunFailedPaymentFlow,
  [switch]$PublishMissingPrice,
  [switch]$RunSandboxSmoke,
  [string]$ReportPath = 'stripe-launch-validation-report.json'
)

$ErrorActionPreference = 'Stop'

$script:Results = New-Object System.Collections.Generic.List[object]
$script:SecretRedactions = New-Object System.Collections.Generic.List[string]

function Protect-SensitiveText {
  param([string]$Text = '')
  $safe = $Text
  foreach ($secret in $script:SecretRedactions) {
    if ($secret) {
      $safe = $safe.Replace($secret, '[redacted]')
    }
  }
  $safe = $safe -replace '(sk|rk)_(test|live)_[A-Za-z0-9]+', '$1_$2_[redacted]'
  $safe = $safe -replace 'whsec_[A-Za-z0-9]+', 'whsec_[redacted]'
  return $safe
}

function Add-Result {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Status,
    [string]$Details = ''
  )
  $safeDetails = Protect-SensitiveText -Text $Details
  $script:Results.Add([pscustomobject]@{
    name = $Name
    status = $Status
    details = $safeDetails
    at = (Get-Date).ToString('o')
  }) | Out-Null
  $color = if ($Status -eq 'pass') { 'Green' } elseif ($Status -eq 'skip') { 'Yellow' } else { 'Red' }
  Write-Host "[$Status] $Name $safeDetails" -ForegroundColor $color
}

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$ScriptBlock
  )
  try {
    $details = & $ScriptBlock
    Add-Result -Name $Name -Status 'pass' -Details ([string]$details)
  } catch {
    Add-Result -Name $Name -Status 'fail' -Details $_.Exception.Message
  }
}

function Invoke-LoggedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )
  $output = & $FilePath @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  $safeOutput = Protect-SensitiveText -Text (($output | Out-String).Trim())
  if ($safeOutput) {
    Write-Host $safeOutput
  }
  if ($exitCode -ne 0) {
    $safeCommand = Protect-SensitiveText -Text "$FilePath $($Arguments -join ' ')"
    $tail = (($safeOutput -split "`r?`n") | Select-Object -Last 40) -join ' '
    throw "$safeCommand exited with $exitCode. Output: $tail"
  }
  return $safeOutput
}

function Get-PowerShellExecutable {
  try {
    $currentProcess = Get-Process -Id $PID -ErrorAction Stop
    if ($currentProcess.Path) { return $currentProcess.Path }
  } catch {
    # Fall back to Windows PowerShell below.
  }
  return 'powershell'
}

function Get-EnvMap {
  param([string]$Path = 'server/.env')
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    $commentIdx = $value.IndexOf(' #')
    if ($commentIdx -ge 0) { $value = $value.Substring(0, $commentIdx).Trim() }
    $map[$key] = $value.Trim('"').Trim("'")
  }
  return $map
}

function Assert-CommandExists {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

function Get-JsonFromCommandOutput {
  param([Parameter(Mandatory = $true)][string]$Output)
  $start = $Output.IndexOf('{')
  if ($start -lt 0) { throw "Command output did not contain JSON." }
  return $Output.Substring($start) | ConvertFrom-Json
}

function Invoke-StripeJson {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $output = & stripe @Arguments --api-key $StripeApiKey
  if ($LASTEXITCODE -ne 0) { throw "stripe $($Arguments -join ' ') failed" }
  return ($output | Out-String | ConvertFrom-Json)
}

function Add-ManualItem {
  param([Parameter(Mandatory = $true)][string]$Details)
  Add-Result -Name 'Manual verification required' -Status 'skip' -Details $Details
}

$envMap = Get-EnvMap
if (-not $StripeApiKey) {
  $StripeApiKey = $envMap['STRIPE_SECRET_KEY']
}
$script:SecretRedactions.Add($StripeApiKey) | Out-Null
$script:SecretRedactions.Add($envMap['STRIPE_SECRET_KEY']) | Out-Null
$script:SecretRedactions.Add($envMap['STRIPE_WEBHOOK_SECRET']) | Out-Null
$script:SecretRedactions.Add($envMap['BILLING_SCHEDULER_SECRET']) | Out-Null
if (-not $env:DB_PROVIDER -and -not $envMap['DB_PROVIDER']) {
  $env:DB_PROVIDER = 'firebase'
}
if (-not $BackendUrl) {
  $BackendUrl = $envMap['API_BASE_URL']
  if (-not $BackendUrl) { $BackendUrl = $envMap['BACKEND_URL'] }
  if (-not $BackendUrl) { $BackendUrl = 'http://localhost:4000' }
}

Invoke-Step 'Required local commands' {
  Assert-CommandExists -Name 'node'
  Assert-CommandExists -Name 'npm'
  if (-not $SkipStripeCli) { Assert-CommandExists -Name 'stripe' }
  if (-not $SkipCloudScheduler) { Assert-CommandExists -Name 'gcloud' }
  'node/npm available'
}

Invoke-Step 'Billing environment variables' {
  $required = @(
    'STRIPE_BILLING_ENABLED',
    'STRIPE_SECRET_KEY',
    'STRIPE_API_VERSION',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PREMIUM_PRODUCT_ID',
    'STRIPE_CHECKOUT_SUCCESS_URL',
    'STRIPE_CHECKOUT_CANCEL_URL',
    'STRIPE_PORTAL_RETURN_URL'
  )
  $missing = @($required | Where-Object { -not $envMap[$_] })
  if ($missing.Count -gt 0) { throw "Missing server/.env keys: $($missing -join ', ')" }
  if ($envMap['STRIPE_BILLING_ENABLED'] -ne 'true') { throw 'STRIPE_BILLING_ENABLED must be true.' }
  if ($envMap['STRIPE_SECRET_KEY'] -notmatch '^(sk|rk)_(test|live)_') { throw 'STRIPE_SECRET_KEY must start with sk_/rk_ test/live prefix.' }
  if ($envMap['STRIPE_API_VERSION'] -ne '2026-06-24.dahlia') {
    throw "STRIPE_API_VERSION must be 2026-06-24.dahlia to match the pinned Stripe SDK/webhook version. Current value: $($envMap['STRIPE_API_VERSION'])"
  }

  # Stripe rejects http:// return/success/cancel URLs in live mode.
  $isLive = $envMap['STRIPE_SECRET_KEY'] -match '^(sk|rk)_live_'
  foreach ($urlKey in @('STRIPE_CHECKOUT_SUCCESS_URL', 'STRIPE_CHECKOUT_CANCEL_URL', 'STRIPE_PORTAL_RETURN_URL')) {
    $val = $envMap[$urlKey]
    if ($val -notmatch '^https?://') { throw "$urlKey must be a valid URL (got: $val)" }
    if ($isLive -and $val -match '^http://') { throw "$urlKey must use https:// in live mode (got: $val)" }
  }

  # AUTH_REDIRECT_URI_ALLOWLIST must include the native app scheme so iOS/Android
  # Google OAuth can complete.  The web URL alone is insufficient for native clients.
  $allowlist = $envMap['AUTH_REDIRECT_URI_ALLOWLIST']
  if (-not $allowlist -or $allowlist -notmatch 'travelitineraryplanner://') {
    throw "AUTH_REDIRECT_URI_ALLOWLIST must contain 'travelitineraryplanner://' for native Google OAuth. Current value: '$allowlist'"
  }

  # Launch validation defaults to Firebase when DB_PROVIDER is omitted.
  # Postgres must be explicit. If DB_PROVIDER=postgres is set, DATABASE_URL is required.
  $provider = $envMap['DB_PROVIDER']
  if (-not $provider) { $provider = $env:DB_PROVIDER }
  if ($provider -eq 'postgres') {
    if (-not $envMap['DATABASE_URL']) { throw 'DB_PROVIDER=postgres requires DATABASE_URL in server/.env.' }
    "DB_PROVIDER=postgres"
  } elseif ($provider -eq 'firebase' -or -not $provider) {
    "DB_PROVIDER=$( if ($provider) { $provider } else { 'firebase (default)' } )"
  } else {
    throw "Unknown DB_PROVIDER value '$provider'. Expected: postgres, firebase, or unset (firebase default)."
  }
}

if (-not $SkipTests) {
  Invoke-Step 'Server TypeScript' {
    Invoke-LoggedCommand -FilePath 'npm' -Arguments @('--prefix', 'server', 'run', 'typecheck')
    'server typecheck passed'
  }
  Invoke-Step 'App TypeScript' {
    Invoke-LoggedCommand -FilePath 'npm' -Arguments @('--prefix', 'app', 'run', 'typecheck')
    'app typecheck passed'
  }
  Invoke-Step 'Server billing tests' {
    Invoke-LoggedCommand -FilePath 'npm' -Arguments @(
      '--prefix', 'server', 'test', '--', '--runInBand',
      '__tests__/billing-routes.test.ts',
      '__tests__/billing-webhook-workflows.test.ts',
      '__tests__/billing-reconciliation.test.ts',
      '__tests__/admin-billing-routes.test.ts',
      '__tests__/billing-entitlement.test.ts',
      '__tests__/billing-entitlement-users.test.ts',
      '__tests__/stripe-billing-config.test.ts'
    )
    'server billing tests passed'
  }
  Invoke-Step 'App billing tests' {
    Invoke-LoggedCommand -FilePath 'npm' -Arguments @(
      '--prefix', 'app', 'test', '--', '--runInBand',
      'tests/adminTab.billing.test.tsx',
      'tests/premiumSubscriptionPanel.test.tsx',
      'tests/premiumPlanComparisonDialog.test.tsx',
      'tests/premiumTrialWelcomeDialog.test.tsx',
      'tests/appStartup.test.tsx',
      'tests/billing.utils.test.ts',
      'tests/useBillingStatus.test.tsx'
    )
    'app billing tests passed'
  }
} else {
  Add-Result -Name 'Automated test suites' -Status 'skip' -Details 'Skipped by -SkipTests'
}

$plansResult = $null
Invoke-Step 'Billing plan config' {
  $output = npm run billing:list-plans --silent | Out-String
  $script:plansResult = Get-JsonFromCommandOutput -Output $output
  $monthly = $script:plansResult.plans | Where-Object { $_.planKey -eq 'premium_monthly' } | Select-Object -First 1
  $annual = $script:plansResult.plans | Where-Object { $_.planKey -eq 'premium_annual' } | Select-Object -First 1
  if (-not $monthly -or -not $annual) { throw 'Missing premium_monthly or premium_annual plan config.' }
  if (-not $monthly.activeStripePriceId) { throw 'premium_monthly activeStripePriceId is null.' }
  if (-not $annual.activeStripePriceId) { throw 'premium_annual activeStripePriceId is null.' }
  if ($monthly.unitAmountCents -le 0 -or $annual.unitAmountCents -le 0) { throw 'Plan prices must be positive.' }
  "monthly=$($monthly.activeStripePriceId), annual=$($annual.activeStripePriceId)"
}

if (-not $SkipStripeCli) {
  Invoke-Step 'Stripe API key and product' {
    if (-not $StripeApiKey -or $StripeApiKey.Length -lt 12) { throw 'StripeApiKey is missing or too short.' }
    $product = Invoke-StripeJson -Arguments @('products', 'retrieve', $envMap['STRIPE_PREMIUM_PRODUCT_ID'])
    if (-not $product.id) { throw 'Could not retrieve Stripe product.' }
    "product=$($product.id), livemode=$($product.livemode)"
  }
  Invoke-Step 'Stripe monthly/annual prices' {
    if (-not $script:plansResult) { throw 'No billing plan config available.' }
    foreach ($plan in $script:plansResult.plans) {
      $price = Invoke-StripeJson -Arguments @('prices', 'retrieve', $plan.activeStripePriceId)
      if ($price.product -ne $envMap['STRIPE_PREMIUM_PRODUCT_ID']) {
        throw "$($plan.planKey) price product mismatch: $($price.product)"
      }
      if ($price.active -ne $true) { throw "$($plan.planKey) price is not active." }
    }
    'Stripe prices retrievable and active'
  }
} else {
  Add-Result -Name 'Stripe CLI checks' -Status 'skip' -Details 'Skipped by -SkipStripeCli'
}

if ($RunSandboxSmoke) {
  Invoke-Step 'Real Stripe sandbox smoke test' {
    if (-not $StripeApiKey -or $StripeApiKey -notmatch '^(sk|rk)_test_') {
      throw 'RunSandboxSmoke requires a test-mode StripeApiKey.'
    }
    $oldSandbox = $env:STRIPE_SANDBOX_TEST
    $oldKey = $env:STRIPE_SECRET_KEY
    try {
      $env:STRIPE_SANDBOX_TEST = '1'
      $env:STRIPE_SECRET_KEY = $StripeApiKey
      Invoke-LoggedCommand -FilePath 'npm' -Arguments @('--prefix', 'server', 'test', '--', '--runInBand', '__tests__/billing-stripe-sandbox.test.ts')
      'sandbox smoke test passed'
    } finally {
      if ($null -eq $oldSandbox) { Remove-Item Env:STRIPE_SANDBOX_TEST -ErrorAction SilentlyContinue } else { $env:STRIPE_SANDBOX_TEST = $oldSandbox }
      if ($null -eq $oldKey) { Remove-Item Env:STRIPE_SECRET_KEY -ErrorAction SilentlyContinue } else { $env:STRIPE_SECRET_KEY = $oldKey }
    }
  }
} else {
  Add-Result -Name 'Real Stripe sandbox smoke test' -Status 'skip' -Details 'Use -RunSandboxSmoke to execute'
}

if ($RunTestClock) {
  Invoke-Step 'Stripe Test Clock workflow' {
    if (-not $UserId -or -not $Email) { throw 'RunTestClock requires -UserId and -Email.' }
    $args = @(
      '-StripeApiKey', $StripeApiKey,
      '-UserId', $UserId,
      '-Email', $Email,
      '-PublishMissingPrice'
    )
    if ($RunFailedPaymentFlow) { $args += '-RunFailedPaymentFlow' }
    $workflowArgs = @('-ExecutionPolicy', 'Bypass', '-File', 'scripts/stripe-test-clock-workflow.ps1') + $args
    Invoke-LoggedCommand -FilePath (Get-PowerShellExecutable) -Arguments $workflowArgs
    'test clock workflow passed'
  }
} else {
  Add-Result -Name 'Stripe Test Clock workflow' -Status 'skip' -Details 'Use -RunTestClock to execute'
}

Invoke-Step 'Cloud Scheduler / reconciliation environment variables' {
  # These vars are required for durable grace-period enforcement on GCP.
  # They are optional for localhost dev (in-process scheduler handles it),
  # but their absence is flagged so the runbook reminder is visible in the report.
  $missing = @()
  if (-not $envMap['BILLING_RECONCILE_ENABLED']) { $missing += 'BILLING_RECONCILE_ENABLED' }
  if (-not $envMap['BILLING_SCHEDULER_SECRET']) { $missing += 'BILLING_SCHEDULER_SECRET' }
  if ($missing.Count -gt 0) {
    if ($SkipCloudScheduler) {
      "WARNING: $($missing -join ', ') not set — acceptable for local dev but required for GCP deployment"
    } else {
      throw "Missing server/.env keys required for Cloud Scheduler: $($missing -join ', '). Set BILLING_RECONCILE_ENABLED=true and BILLING_SCHEDULER_SECRET=<secret>, or use -SkipCloudScheduler to bypass this check."
    }
  } else {
    if ($envMap['BILLING_RECONCILE_ENABLED'] -ne 'true') {
      throw 'BILLING_RECONCILE_ENABLED must be true for Cloud Scheduler to trigger reconciliation.'
    }
    'BILLING_RECONCILE_ENABLED=true, BILLING_SCHEDULER_SECRET is set'
  }
}

if (-not $SkipCloudScheduler) {
  Invoke-Step 'Cloud Scheduler job exists' {
    Invoke-LoggedCommand -FilePath 'gcloud' -Arguments @('scheduler', 'jobs', 'describe', $SchedulerJobName, '--location', $SchedulerRegion)
    "job=$SchedulerJobName location=$SchedulerRegion"
  }
  if ($RunCloudScheduler) {
    Invoke-Step 'Cloud Scheduler manual run' {
      Invoke-LoggedCommand -FilePath 'gcloud' -Arguments @('scheduler', 'jobs', 'run', $SchedulerJobName, '--location', $SchedulerRegion)
      'scheduler run triggered; verify Cloud Run logs for {"ok":true}'
    }
  } else {
    Add-Result -Name 'Cloud Scheduler manual run' -Status 'skip' -Details 'Use -RunCloudScheduler to trigger'
  }
} else {
  Add-Result -Name 'Cloud Scheduler checks' -Status 'skip' -Details 'Skipped by -SkipCloudScheduler'
}

if ($AdminToken) {
  Invoke-Step 'Admin billing config endpoint' {
    $headers = @{ Authorization = "Bearer $AdminToken" }
    $response = Invoke-RestMethod -Uri "$BackendUrl/api/admin/billing/config" -Headers $headers -Method Get
    if (-not $response.plans) { throw 'No plans returned.' }
    "plans=$($response.plans.Count)"
  }
} else {
  Add-Result -Name 'Admin billing API checks' -Status 'skip' -Details 'Pass -AdminToken to query protected admin endpoints'
}

Add-ManualItem 'Stripe Dashboard: account activation, public details, branding, payout settings, and enforced team 2FA.'
Add-ManualItem 'Stripe Dashboard: Premium product tax code and monthly/annual prices under the same product.'
Add-ManualItem 'Stripe Dashboard: Stripe Tax origin, registrations, and product/price tax behavior.'
Add-ManualItem 'Stripe Dashboard: Customer Portal cancellation behavior, plan switching, payment methods, invoices, and return URL.'
Add-ManualItem 'App UI: new-account Premium comparison modal, Account Premium panel, checkout success/cancel URLs, and native "manage on web" copy.'
Add-ManualItem 'Webhook delivery: verify recent Stripe webhook events are 2xx and Cloud Run logs show no billing.webhook processing errors.'
Add-ManualItem 'Production cutover: separate live database/deployment, live Stripe keys/prices/webhook endpoint, and no test-mode IDs in production config.'

$summary = [pscustomobject]@{
  generatedAt = (Get-Date).ToString('o')
  backendUrl = $BackendUrl
  passed = @($script:Results | Where-Object { $_.status -eq 'pass' }).Count
  failed = @($script:Results | Where-Object { $_.status -eq 'fail' }).Count
  skipped = @($script:Results | Where-Object { $_.status -eq 'skip' }).Count
  results = $script:Results
}

$summary | ConvertTo-Json -Depth 6 | Set-Content -Path $ReportPath -Encoding UTF8

Write-Host ''
Write-Host "Report written to $ReportPath"
Write-Host "Passed: $($summary.passed)  Failed: $($summary.failed)  Skipped/manual: $($summary.skipped)"

if ($summary.failed -gt 0) {
  exit 1
}
