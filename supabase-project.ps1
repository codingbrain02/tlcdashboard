param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CliArgs
)

$ErrorActionPreference = 'Stop'
$expectedEmail = 'codingbrain02@gmail.com'
$expectedProject = 'fxldcjqqlhnbdrpapadu'
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
  $identityJson = & npx.cmd supabase whoami --output-format json
  if ($LASTEXITCODE -ne 0) { throw 'Supabase CLI is not logged in.' }
  $identity = $identityJson | ConvertFrom-Json
  if ($identity.email -ne $expectedEmail) {
    throw "Supabase CLI is signed in as $($identity.email), not $expectedEmail. Run 'npx supabase login --no-browser' with the correct account."
  }

  $projectsJson = & npx.cmd supabase projects list --output-format json
  if ($LASTEXITCODE -ne 0) { throw 'Could not verify Supabase project access.' }
  $projects = $projectsJson | ConvertFrom-Json
  if (-not ($projects.projects | Where-Object { $_.ref -eq $expectedProject })) {
    throw 'The signed-in account cannot access the tlcdashboard Supabase project.'
  }

  & npx.cmd supabase @CliArgs
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
