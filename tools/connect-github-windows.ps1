# Couch Bandit: give this Windows laptop read + write access to GitHub (RnR4ZOR).
# Your only job: approve the login in the browser when it opens.
$ErrorActionPreference = "Continue"
$Repo = "RnR4ZOR/CouchBandit"
$Dest = Join-Path $env:USERPROFILE "CouchBandit"

function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User") }
function Need($cmd, $id) {
  if (Get-Command $cmd -ErrorAction SilentlyContinue) { Write-Host "$cmd already installed."; return }
  Write-Host "Installing $id..."
  winget install --id $id -e --silent --accept-source-agreements --accept-package-agreements | Out-Null
  Refresh-Path
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Couldn't install $id automatically. Install it from the link below, then run this again:"
    if ($id -eq "Git.Git") { Write-Host "https://git-scm.com/download/win" } else { Write-Host "https://cli.github.com" }
    exit 1
  }
}

Write-Host "== 1. Installing tools =="
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host "winget is missing. Install 'App Installer' from the Microsoft Store, then run this again."; exit 1
}
Need git "Git.Git"
Need gh "GitHub.cli"

Write-Host "== 2. Signing in to GitHub =="
gh auth status -h github.com 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "A browser will open. Press Enter here, paste/type the code shown, click Authorize."
  gh auth login --hostname github.com --git-protocol https --web --scopes "repo,workflow"
}
gh auth setup-git
$me = gh api user --jq .login
Write-Host "Signed in as $me"

Write-Host "== 3. Getting Couch Bandit =="
if (-not (git config --global user.name))  { git config --global user.name  $me }
if (-not (git config --global user.email)) { git config --global user.email "$(gh api user --jq .id)+$me@users.noreply.github.com" }
if (Test-Path (Join-Path $Dest ".git")) { git -C $Dest pull } else { gh repo clone $Repo $Dest }

$push = gh api "repos/$Repo" --jq .permissions.push
Write-Host ""
if ($push -eq "true") { Write-Host "Done. Read + write access confirmed. Couch Bandit is in $Dest" }
else { Write-Host "Signed in, but this account can't push to $Repo. Make sure you signed in as RnR4ZOR." }
Read-Host "Press Enter to close"
