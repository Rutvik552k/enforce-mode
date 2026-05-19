# Combined statusline — shows both enforce and caveman badges
$Esc = [char]27
$Parts = @()

# Enforce badge (red)
$EnforceFlag = Join-Path $HOME ".claude/.enforce-active"
if (Test-Path $EnforceFlag) {
    $Mode = (Get-Content $EnforceFlag -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not [string]::IsNullOrWhiteSpace($Mode)) {
        $Suffix = $Mode.Trim().ToUpperInvariant()
        $Parts += "${Esc}[38;5;196m[ENFORCE:$Suffix]${Esc}[0m"
    }
}

# Caveman badge (orange)
$CavemanFlag = Join-Path $HOME ".claude/.caveman-active"
if (Test-Path $CavemanFlag) {
    $CMode = ""
    try {
        $CMode = (Get-Content $CavemanFlag -ErrorAction Stop | Select-Object -First 1).Trim()
    } catch {}
    if ([string]::IsNullOrEmpty($CMode) -or $CMode -eq "full") {
        $Parts += "${Esc}[38;5;172m[CAVEMAN]${Esc}[0m"
    } else {
        $CSuffix = $CMode.ToUpperInvariant()
        $Parts += "${Esc}[38;5;172m[CAVEMAN:$CSuffix]${Esc}[0m"
    }
}

if ($Parts.Count -gt 0) {
    [Console]::Write($Parts -join " ")
}
