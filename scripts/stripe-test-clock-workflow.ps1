param(
  [Parameter(Mandatory = $true)]
  [string]$StripeApiKey,

  [Parameter(Mandatory = $true)]
  [string]$UserId,

  [Parameter(Mandatory = $true)]
  [string]$Email,

  [string]$MonthlyPriceId = '',

  [int]$TrialDays = 14,

  [switch]$PublishMissingPrice,

  [switch]$RunFailedPaymentFlow
)

$ErrorActionPreference = 'Stop'

function Protect-SensitiveText {
  param([string]$Text = '')
  $safe = $Text.Replace($StripeApiKey, '[redacted]')
  $safe = $safe -replace '(sk|rk)_(test|live)_[A-Za-z0-9]+', '$1_$2_[redacted]'
  return $safe
}

function Assert-Command {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

function Invoke-StripeJson {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $output = & stripe @Arguments --api-key $StripeApiKey 2>&1
  $exitCode = $LASTEXITCODE
  $safeOutput = Protect-SensitiveText -Text (($output | Out-String).Trim())
  if ($exitCode -ne 0) {
    throw "Stripe CLI failed: stripe $($Arguments -join ' ') --api-key [redacted]. Output: $safeOutput"
  }
  return ($output | Out-String | ConvertFrom-Json)
}

function Get-JsonFromCommandOutput {
  param([Parameter(Mandatory = $true)][string]$Output)
  $start = $Output.IndexOf('{')
  if ($start -lt 0) {
    throw "Command output did not contain JSON:`n$Output"
  }
  return $Output.Substring($start) | ConvertFrom-Json
}

function Get-ActiveMonthlyPriceId {
  $output = npm run billing:list-plans --silent | Out-String
  $plansResult = Get-JsonFromCommandOutput -Output $output
  $monthly = $plansResult.plans | Where-Object { $_.planKey -eq 'premium_monthly' } | Select-Object -First 1
  if (-not $monthly) {
    throw 'No premium_monthly plan was returned by billing:list-plans.'
  }
  return [string]$monthly.activeStripePriceId
}

function Wait-StripeTestClockReady {
  param(
    [Parameter(Mandatory = $true)][string]$ClockId
  )

  do {
    $clock = Invoke-StripeJson -Arguments @('test_helpers', 'test_clocks', 'retrieve', $ClockId)
    if ($clock.status -eq 'ready') {
      Write-Host "Clock ready: $ClockId"
      return
    }
    if ($clock.status -eq 'internal_failure') {
      throw "Stripe Test Clock failed internally: $ClockId"
    }

    Write-Host "Clock status is $($clock.status); waiting..."
    Start-Sleep -Seconds 10
  } while ($true)
}

function New-CardPaymentMethod {
  param([Parameter(Mandatory = $true)][string]$CardNumber)

  return Invoke-StripeJson -Arguments @(
    'payment_methods', 'create',
    '-d', 'type=card',
    '-d', "card[number]=$CardNumber",
    '-d', 'card[exp_month]=12',
    '-d', 'card[exp_year]=2034',
    '-d', 'card[cvc]=123'
  )
}

Assert-Command -Name 'stripe'
Assert-Command -Name 'npm'

if ($StripeApiKey.Length -lt 12 -or $StripeApiKey -notmatch '^(sk|rk)_test_') {
  throw 'StripeApiKey must be a full test-mode key, e.g. sk_test_... or rk_test_...'
}
if (-not $Email.Contains('@')) {
  throw 'Email must be a valid email address.'
}
if (-not $UserId.Trim()) {
  throw 'UserId is required.'
}

if (-not $MonthlyPriceId.Trim()) {
  $MonthlyPriceId = Get-ActiveMonthlyPriceId
}

if (-not $MonthlyPriceId.Trim() -and $PublishMissingPrice) {
  Write-Host 'No active monthly price found. Publishing premium_monthly from configured Admin Billing settings...'
  npm run billing:publish-price -- --plan-key premium_monthly --confirm-publish-price
  if ($LASTEXITCODE -ne 0) {
    throw 'billing:publish-price failed.'
  }
  $MonthlyPriceId = Get-ActiveMonthlyPriceId
}

if (-not $MonthlyPriceId.Trim()) {
  throw 'MonthlyPriceId is empty. Publish a Premium Monthly price or pass -MonthlyPriceId price_...'
}
if ($MonthlyPriceId -notmatch '^price_') {
  throw "MonthlyPriceId must start with price_. Got: $MonthlyPriceId"
}

$now = [int][double]::Parse((Get-Date -UFormat '%s'))

Write-Host 'Creating Stripe Test Clock...'
$clock = Invoke-StripeJson -Arguments @(
  'test_helpers', 'test_clocks', 'create',
  '--frozen-time', "$now",
  '--name', 'WanderBunnies acceptance'
)
$clockId = [string]$clock.id
Write-Host "Clock: $clockId"

Write-Host 'Creating Stripe Customer attached to clock...'
$customer = Invoke-StripeJson -Arguments @(
  'customers', 'create',
  '-d', "email=$Email",
  '-d', "metadata[userId]=$UserId",
  '-d', "test_clock=$clockId"
)
Write-Host "Customer: $($customer.id)"

Write-Host 'Installing successful default card for trial-end payment...'
$initialPaymentMethod = New-CardPaymentMethod -CardNumber '4242424242424242'
Invoke-StripeJson -Arguments @(
  'payment_methods', 'attach',
  $initialPaymentMethod.id,
  '-d', "customer=$($customer.id)"
) | Out-Null
Invoke-StripeJson -Arguments @(
  'customers', 'update',
  $customer.id,
  '-d', "invoice_settings[default_payment_method]=$($initialPaymentMethod.id)"
) | Out-Null

Write-Host 'Linking Stripe Customer to app billing customer record...'
npm run billing:link-customer -- `
  --user-id $UserId `
  --stripe-customer-id $($customer.id) `
  --email $Email `
  --livemode false `
  --confirm-test-clock-link `
  --allow-replace-test-customer
if ($LASTEXITCODE -ne 0) {
  throw 'billing:link-customer failed.'
}

Write-Host 'Creating trialing subscription...'
$subscription = Invoke-StripeJson -Arguments @(
  'subscriptions', 'create',
  '-d', "customer=$($customer.id)",
  '-d', "items[0][price]=$MonthlyPriceId",
  '-d', "trial_period_days=$TrialDays",
  '-d', "default_payment_method=$($initialPaymentMethod.id)",
  '-d', "metadata[userId]=$UserId",
  '-d', 'metadata[planKey]=premium_monthly'
)
Write-Host "Subscription: $($subscription.id)"

$trialEnd = $now + ($TrialDays * 86400) + 3600
Write-Host "Advancing through trial to Unix time $trialEnd..."
Invoke-StripeJson -Arguments @(
  'test_helpers', 'test_clocks', 'advance',
  $clockId,
  '--frozen-time', "$trialEnd"
) | Out-Null
Wait-StripeTestClockReady -ClockId $clockId

if ($RunFailedPaymentFlow) {
  Write-Host 'Installing failing card as default payment method...'
  $failingPaymentMethod = New-CardPaymentMethod -CardNumber '4000000000000341'
  Invoke-StripeJson -Arguments @(
    'payment_methods', 'attach',
    $failingPaymentMethod.id,
    '-d', "customer=$($customer.id)"
  ) | Out-Null
  Invoke-StripeJson -Arguments @(
    'customers', 'update',
    $customer.id,
    '-d', "invoice_settings[default_payment_method]=$($failingPaymentMethod.id)"
  ) | Out-Null
  Invoke-StripeJson -Arguments @(
    'subscriptions', 'update',
    $subscription.id,
    '-d', "default_payment_method=$($failingPaymentMethod.id)"
  ) | Out-Null

  $renewal = $trialEnd + (30 * 86400) + 3600
  Write-Host "Advancing to renewal with failing payment method: $renewal..."
  Invoke-StripeJson -Arguments @(
    'test_helpers', 'test_clocks', 'advance',
    $clockId,
    '--frozen-time', "$renewal"
  ) | Out-Null
  Wait-StripeTestClockReady -ClockId $clockId

  $invoices = Invoke-StripeJson -Arguments @(
    'invoices', 'list',
    '-d', "customer=$($customer.id)",
    '--limit', '1'
  )
  $invoiceId = [string]$invoices.data[0].id
  Write-Host "Latest invoice after renewal: $invoiceId"

  $day13 = $renewal + (13 * 86400)
  Write-Host "Advancing to grace day 13: $day13..."
  Invoke-StripeJson -Arguments @(
    'test_helpers', 'test_clocks', 'advance',
    $clockId,
    '--frozen-time', "$day13"
  ) | Out-Null
  Wait-StripeTestClockReady -ClockId $clockId

  $day15 = $renewal + (15 * 86400)
  Write-Host "Advancing to grace day 15: $day15..."
  Invoke-StripeJson -Arguments @(
    'test_helpers', 'test_clocks', 'advance',
    $clockId,
    '--frozen-time', "$day15"
  ) | Out-Null
  Wait-StripeTestClockReady -ClockId $clockId

  Write-Host 'Installing successful card and retrying invoice payment...'
  $successPaymentMethod = New-CardPaymentMethod -CardNumber '4242424242424242'
  Invoke-StripeJson -Arguments @(
    'payment_methods', 'attach',
    $successPaymentMethod.id,
    '-d', "customer=$($customer.id)"
  ) | Out-Null
  Invoke-StripeJson -Arguments @(
    'customers', 'update',
    $customer.id,
    '-d', "invoice_settings[default_payment_method]=$($successPaymentMethod.id)"
  ) | Out-Null
  Invoke-StripeJson -Arguments @(
    'subscriptions', 'update',
    $subscription.id,
    '-d', "default_payment_method=$($successPaymentMethod.id)"
  ) | Out-Null
  Invoke-StripeJson -Arguments @('invoices', 'pay', $invoiceId) | Out-Null
  Write-Host "Retried invoice payment: $invoiceId"
}

Write-Host ''
Write-Host 'Done. Keep these IDs for manual checks/cleanup:'
Write-Host "ClockId=$clockId"
Write-Host "CustomerId=$($customer.id)"
Write-Host "SubscriptionId=$($subscription.id)"
Write-Host "MonthlyPriceId=$MonthlyPriceId"
