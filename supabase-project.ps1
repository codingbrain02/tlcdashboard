param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CliArgs
)

$ErrorActionPreference = 'Stop'
$expectedEmail = 'codingbrain02@gmail.com'
$expectedProject = 'fxldcjqqlhnbdrpapadu'
$profileName = 'tlcdashboard'
$projectRoot = $PSScriptRoot
$linkedProjectFile = Join-Path $projectRoot 'supabase/.temp/project-ref'

if (-not (Test-Path -LiteralPath $linkedProjectFile)) {
  throw 'Supabase project is not linked. Link tlcdashboard before running remote commands.'
}

$linkedProject = (Get-Content -LiteralPath $linkedProjectFile -Raw).Trim()
if ($linkedProject -ne $expectedProject) {
  throw "Wrong Supabase project linked: $linkedProject"
}

Push-Location $projectRoot
try {
  $profileArgs = @('--profile', $profileName)
  $identityJson = & npx.cmd supabase whoami @profileArgs --output-format json 2>$null
  if ($LASTEXITCODE -ne 0) {
    # The default CLI session is also safe when it passes the same owner and
    # project checks. This supports users who signed in without --name.
    $profileArgs = @()
    $identityJson = & npx.cmd supabase whoami --output-format json
    if ($LASTEXITCODE -ne 0) { throw 'Supabase CLI is not logged in. Sign in as the tlcdashboard project owner.' }
  }
  $identity = $identityJson | ConvertFrom-Json
  if ($identity.email -ne $expectedEmail) {
    throw "Supabase CLI is signed in as $($identity.email), not $expectedEmail. Sign in with the project owner account."
  }

  $projectsJson = & npx.cmd supabase projects list @profileArgs --output-format json
  if ($LASTEXITCODE -ne 0) { throw 'Could not verify Supabase project access.' }
  $projects = $projectsJson | ConvertFrom-Json
  if (-not ($projects.projects | Where-Object { $_.ref -eq $expectedProject })) {
    throw 'The signed-in account cannot access the tlcdashboard Supabase project.'
  }

  & npx.cmd supabase @CliArgs @profileArgs
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
