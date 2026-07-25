# Farmkogls Booking Console - one-shot deploy to GitHub Pages
# ASCII only on purpose: PowerShell 5.1 reads .ps1 as ANSI and mangles non-ASCII.

$ErrorActionPreference = 'Stop'

$repoName = 'farmkogls-console'
$root     = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- locate git and gh (neither is on PATH by default on this machine) ---
$git = 'C:\Program Files\Git\cmd\git.exe'
if (-not (Test-Path $git)) {
    $c = Get-Command git -ErrorAction SilentlyContinue
    if ($c) { $git = $c.Source } else { throw 'git not found' }
}

$gh = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter gh.exe -ErrorAction SilentlyContinue |
       Select-Object -First 1).FullName
if (-not $gh) {
    $c = Get-Command gh -ErrorAction SilentlyContinue
    if ($c) { $gh = $c.Source } else { throw 'gh not found' }
}

$env:PATH = (Split-Path -Parent $git) + ';' + $env:PATH
Set-Location $root

Write-Host ''
Write-Host '[1/5] checking login' -ForegroundColor Cyan
& $gh auth status
if (-not $?) { throw 'gh auth login required' }

Write-Host ''
Write-Host '[2/5] safety check - no spreadsheets may be published' -ForegroundColor Cyan
$tracked = & $git ls-files
$leak = $tracked | Where-Object { $_ -match '\.(xlsx|xlsm|xls|csv)$' }
if ($leak) {
    Write-Host 'ABORT - spreadsheet files are tracked:' -ForegroundColor Red
    $leak | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    throw 'refusing to publish booking data'
}
Write-Host "  clean - $($tracked.Count) files, 0 spreadsheets" -ForegroundColor Green

$user = (& $gh api user --jq .login).Trim()

Write-Host ''
Write-Host '[3/5] creating repo and pushing' -ForegroundColor Cyan
$exists = $false
& $gh repo view "$user/$repoName" 1>$null 2>$null
if ($?) { $exists = $true }

if ($exists) {
    Write-Host '  repo already exists - pushing only'
    & $git remote get-url origin 1>$null 2>$null
    if (-not $?) { & $git remote add origin "https://github.com/$user/$repoName.git" }
    & $git push -u origin main
} else {
    & $gh repo create $repoName --public --source=. --remote=origin --push `
        --description 'Farmkogls Booking Console - Excel in, Excel out'
}
if (-not $?) { throw 'push failed' }

Write-Host ''
Write-Host '[4/5] enabling GitHub Pages' -ForegroundColor Cyan
& $gh api "repos/$user/$repoName/pages" 1>$null 2>$null
if ($?) {
    Write-Host '  already enabled'
} else {
    try {
        & $gh api -X POST "repos/$user/$repoName/pages" `
            -f 'source[branch]=main' -f 'source[path]=/' 1>$null
    } catch {
        Write-Host '  API call failed - turn it on in the web UI:' -ForegroundColor Yellow
        Write-Host "  https://github.com/$user/$repoName/settings/pages" -ForegroundColor Yellow
        Write-Host '  Source: Deploy from a branch / Branch: main / Folder: (root)' -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host '[5/5] done' -ForegroundColor Cyan
$url = "https://$user.github.io/$repoName/"
Write-Host ''
Write-Host "  repo : https://github.com/$user/$repoName"
Write-Host "  site : $url" -ForegroundColor Green
Write-Host '  PIN  : 0821'
Write-Host ''
Write-Host '  The site takes 1-2 minutes to go live on the first deploy.'
Write-Host ''
