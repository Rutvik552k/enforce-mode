# enforce-mode — statusline badge for Windows PowerShell
# Reads flag file and outputs ANSI-colored badge

$Flag = Join-Path $HOME ".claude/.enforce-active"
if (-not (Test-Path $Flag)) { exit 0 }

$Mode = (Get-Content $Flag -ErrorAction SilentlyContinue | Select-Object -First 1)
if ([string]::IsNullOrWhiteSpace($Mode)) { exit 0 }

$Suffix = $Mode.Trim().ToUpperInvariant()
# ANSI color 196 = bright red (distinct from caveman's 172 orange)
$Esc = [char]27
[Console]::Write("${Esc}[38;5;196m[ENFORCE:$Suffix]${Esc}[0m")
