# enforce-mode — standalone installer for Windows PowerShell
#
# Copies hook files to ~/.claude/hooks/ and wires them into settings.json.
# Idempotent — safe to run multiple times. Use -Force to reinstall.
#
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1 [-Force]

param([switch]$Force)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = Join-Path $HOME '.claude'
$HooksDir = Join-Path $ClaudeDir 'hooks'
$SettingsFile = Join-Path $ClaudeDir 'settings.json'

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'Node.js is required. Install it first.'
    exit 1
}

# Check if already installed
if ((Test-Path (Join-Path $HooksDir 'enforce-activate.js')) -and -not $Force) {
    Write-Host 'enforce-mode is already installed. Use -Force to reinstall.'
    exit 0
}

Write-Host 'Installing enforce-mode...'

# Create directories
New-Item -ItemType Directory -Path $HooksDir -Force | Out-Null

# Copy hook files
$hookFiles = @(
    'enforce-config.js',
    'enforce-detect.js',
    'enforce-rules.js',
    'enforce-activate.js',
    'enforce-state.js',
    'enforce-mode-tracker.js',
    'enforce-statusline.ps1',
    'enforce-statusline.sh',
    'enforce-statusline-setup.js',
    'enforce-research-gate.js',
    'enforce-test-gate.js',
    'enforce-pre-completion.js',
    'enforce-compress.js',
    'enforce-write-guard.js',
    'enforce-bash-guard.js',
    'enforce-stop-guard.js',
    'enforce-uninstall.js'
)
foreach ($file in $hookFiles) {
    Copy-Item (Join-Path $ScriptDir $file) -Destination $HooksDir -Force
}

# Copy rules
$rulesDir = Join-Path $ClaudeDir 'rules'
$domainsDir = Join-Path $rulesDir 'domains'
New-Item -ItemType Directory -Path $domainsDir -Force | Out-Null
Copy-Item (Join-Path $ScriptDir '..\rules\CLAUDE.md') -Destination $rulesDir -Force
Get-ChildItem (Join-Path $ScriptDir '..\rules\domains\*.md') | ForEach-Object {
    Copy-Item $_.FullName -Destination $domainsDir -Force
}

# Record exactly which domain rule files we copied — lets uninstall remove the
# full set cleanly without touching the user's own domain rules.
$ManifestPath = Join-Path $ClaudeDir '.enforce-rules-manifest'
Get-ChildItem (Join-Path $ScriptDir '..\rules\domains\*.md') |
    ForEach-Object { $_.Name } |
    Set-Content -Path $ManifestPath -Encoding utf8

# Copy skills
$skillsDir = Join-Path $ClaudeDir 'skills\enforce'
New-Item -ItemType Directory -Path $skillsDir -Force | Out-Null
Copy-Item (Join-Path $ScriptDir '..\skills\enforce\SKILL.md') -Destination $skillsDir -Force

# Wire hooks into settings.json
if (-not (Test-Path $SettingsFile)) {
    Set-Content -Path $SettingsFile -Value '{}'
}

# Backup
Copy-Item $SettingsFile "$SettingsFile.bak" -Force

# Use forward slashes for Node.js compatibility
$HooksDirFwd = $HooksDir -replace '\\', '/'
$SettingsFileFwd = $SettingsFile -replace '\\', '/'

$nodeScript = @"
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SettingsFileFwd', 'utf8'));

if (!settings.hooks) settings.hooks = {};

function hookExists(entries, needle) {
  return (entries || []).some(entry =>
    (entry.hooks || []).some(h => h.command && h.command.includes(needle))
  );
}

if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
if (!hookExists(settings.hooks.SessionStart, 'enforce-activate')) {
  settings.hooks.SessionStart.push({
    matcher: '',
    hooks: [{ type: 'command', command: 'node $HooksDirFwd/enforce-activate.js', timeout: 10000 }]
  });
}

if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];
if (!hookExists(settings.hooks.UserPromptSubmit, 'enforce-mode-tracker')) {
  settings.hooks.UserPromptSubmit.push({
    matcher: '',
    hooks: [{ type: 'command', command: 'node $HooksDirFwd/enforce-mode-tracker.js', timeout: 5000 }]
  });
}

if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];
if (!hookExists(settings.hooks.PreToolUse, 'enforce-write-guard')) {
  settings.hooks.PreToolUse.push({
    matcher: 'Write|Edit|NotebookEdit',
    hooks: [{ type: 'command', command: 'node $HooksDirFwd/enforce-write-guard.js', timeout: 5000 }]
  });
}
if (!hookExists(settings.hooks.PreToolUse, 'enforce-bash-guard')) {
  settings.hooks.PreToolUse.push({
    matcher: 'Bash',
    hooks: [{ type: 'command', command: 'node $HooksDirFwd/enforce-bash-guard.js', timeout: 5000 }]
  });
}

if (!settings.hooks.Stop) settings.hooks.Stop = [];
if (!hookExists(settings.hooks.Stop, 'enforce-stop-guard')) {
  settings.hooks.Stop.push({
    matcher: '',
    hooks: [{ type: 'command', command: 'node $HooksDirFwd/enforce-stop-guard.js', timeout: 5000 }]
  });
}

if (!settings.statusLine) {
  settings.statusLine = {
    type: 'command',
    command: 'powershell -ExecutionPolicy Bypass -File "$HooksDirFwd/enforce-statusline.ps1"'
  };
}

fs.writeFileSync('$SettingsFileFwd', JSON.stringify(settings, null, 2));
"@

node -e $nodeScript

Write-Host 'enforce-mode installed successfully!'
Write-Host 'Default level: solo'
Write-Host 'Switch: /enforce solo|team|prod'
Write-Host 'Disable: /enforce off'
