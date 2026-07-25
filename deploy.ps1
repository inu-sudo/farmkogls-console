# Farmkogls Booking Console - one-shot deploy to GitHub Pages
# ASCII only on purpose: PowerShell 5.1 reads .ps1 as ANSI and mangles non-ASCII.
#
# Note: do NOT set $ErrorActionPreference = 'Stop' here. In PS 5.1 a native exe
# that writes to stderr (gh reporting "repo not found", which is a normal answer
# for us) becomes a terminating NativeCommandError. Exit codes are checked
# explicitly instead.

$ErrorActionPreference = 'Continue'

$repoName = 'farmkogls-console'
$root     = Split-Path -Parent $MyInvocation.MyCommand.Path

function Fail($msg) {
    Write-Host ''
    Write-Host "STOPPED: $msg" -ForegroundColor Red
    Write-Host ''
    exit 1
}

# --- locate git and gh (neither is on PATH by default on this machine) ---
$git = 'C:\Program Files\Git\cmd\git.exe'
if (-not (Test-Path $git)) {
    $c = Get-Command git -ErrorAction SilentlyContinue
    if ($c) { $git = $c.Source } else { Fail 'git not found' }
}

$gh = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter gh.exe -ErrorAction SilentlyContinue |
       Select-Object -First 1).FullName
if (-not $gh) {
    $c = Get-Command gh -ErrorAction SilentlyContinue
    if ($c) { $gh = $c.Source } else { Fail 'gh not found' }
}

$env:PATH = (Split-Path -Parent $git) + ';' + $env:PATH
Set-Location $root

# --- 1. login ------------------------------------------------------------
Write-Host ''
Write-Host '[1/5] checking login' -ForegroundColor Cyan
$user = (& $gh api user --jq .login)
if ($LASTEXITCODE -ne 0 -or -not $user) { Fail 'not logged in - run: gh auth login' }
$user = "$user".Trim()
Write-Host "  logged in as $user" -ForegroundColor Green

# --- 2. safety check -----------------------------------------------------
Write-Host ''
Write-Host '[2/5] safety check - no spreadsheets may be published' -ForegroundColor Cyan
$tracked = & $git ls-files
$leak = $tracked | Where-Object { $_ -match '\.(xlsx|xlsm|xls|csv)$' }
if ($leak) {
    $leak | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Fail 'spreadsheet files are tracked - refusing to publish booking data'
}
Write-Host "  clean - $($tracked.Count) files, 0 spreadsheets" -ForegroundColor Green

# --- 3. create + push ----------------------------------------------------
Write-Host ''
Write-Host '[3/5] creating repo and pushing' -ForegroundColor Cyan

# List repos instead of probing one: 'repo list' exits 0 whether or not the
# name is there, so there is no stderr to trip over.
$names = & $gh repo list $user --limit 300 --json name --jq '.[].name'
if ($LASTEXITCODE -ne 0) { Fail 'could not list repositories' }
$exists = @($names) -contains $repoName

if ($exists) {
    Write-Host '  repo already exists - pushing only'
    $remotes = & $git remote
    if (@($remotes) -notcontains 'origin') {
        & $git remote add origin "https://github.com/$user/$repoName.git"
    }
    & $git push -u origin main
    if ($LASTEXITCODE -ne 0) { Fail 'push failed' }
} else {
    & $gh repo create $repoName --public --source=. --remote=origin --push `
        --description 'Farmkogls Booking Console - Excel in, Excel out'
    if ($LASTEXITCODE -ne 0) { Fail 'repo create failed' }
}
Write-Host '  pushed' -ForegroundColor Green

# --- 4. pages ------------------------------------------------------------
Write-Host ''
Write-Host '[4/5] enabling GitHub Pages' -ForegroundColor Cyan

$hasPages = & $gh api "repos/$user/$repoName" --jq .has_pages
$pagesOn = ($LASTEXITCODE -eq 0 -and "$hasPages".Trim() -eq 'true')

if ($pagesOn) {
    Write-Host '  already enabled' -ForegroundColor Green
} else {
    $null = & $gh api -X POST "repos/$user/$repoName/pages" `
        -f 'source[branch]=main' -f 'source[path]=/'
    if ($LASTEXITCODE -eq 0) {
        Write-Host '  enabled' -ForegroundColor Green
    } else {
        Write-Host '  API call did not go through - turn it on in the browser:' -ForegroundColor Yellow
        Write-Host "  https://github.com/$user/$repoName/settings/pages" -ForegroundColor Yellow
        Write-Host '  Source: Deploy from a branch / Branch: main / Folder: (root) / Save' -ForegroundColor Yellow
    }
}

# --- 5. done -------------------------------------------------------------
Write-Host ''
Write-Host '[5/5] done' -ForegroundColor Cyan
Write-Host ''
Write-Host "  repo : https://github.com/$user/$repoName"
Write-Host "  site : https://$user.github.io/$repoName/" -ForegroundColor Green
Write-Host "  docs : https://$user.github.io/$repoName/docs.html"
Write-Host '  PIN  : see farmkogls-console\pin.txt (never committed)'
Write-Host ''
Write-Host '  The first deploy takes 1-2 minutes to go live.'
Write-Host ''
