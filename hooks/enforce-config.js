#!/usr/bin/env node
/**
 * enforce-mode — shared configuration resolver
 *
 * Resolution order for default level:
 *   1. ENFORCE_DEFAULT_LEVEL environment variable
 *   2. Config file defaultLevel field:
 *      - $XDG_CONFIG_HOME/enforce-mode/config.json (any platform, if set)
 *      - ~/.config/enforce-mode/config.json (macOS / Linux fallback)
 *      - %APPDATA%\enforce-mode\config.json (Windows fallback)
 *   3. Plugin settings in ~/.claude/settings.json (pluginSettings.enforce-mode.defaultLevel)
 *   4. 'solo'
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const VALID_LEVELS = ['off', 'solo', 'team', 'prod'];

const claudeDir = path.join(os.homedir(), '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');

function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'enforce-mode');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'enforce-mode'
    );
  }
  return path.join(os.homedir(), '.config', 'enforce-mode');
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Read level from plugin settings in ~/.claude/settings.json
 */
function getPluginSettingsLevel() {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const level = settings.pluginSettings?.['enforce-mode']?.defaultLevel;
    if (level && VALID_LEVELS.includes(level.toLowerCase())) {
      return level.toLowerCase();
    }
  } catch { /* settings.json missing or invalid */ }
  return null;
}

function getDefaultLevel() {
  // 1. Environment variable (highest priority)
  const envLevel = process.env.ENFORCE_DEFAULT_LEVEL;
  if (envLevel && VALID_LEVELS.includes(envLevel.toLowerCase())) {
    return envLevel.toLowerCase();
  }

  // 2. Config file
  try {
    const configPath = getConfigPath();
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.defaultLevel && VALID_LEVELS.includes(config.defaultLevel.toLowerCase())) {
      return config.defaultLevel.toLowerCase();
    }
  } catch (e) {
    // Config file doesn't exist or is invalid — fall through
  }

  // 3. Plugin settings in settings.json
  const pluginLevel = getPluginSettingsLevel();
  if (pluginLevel) return pluginLevel;

  // 4. Default
  return 'solo';
}

/**
 * Persist level to config file and plugin settings.
 * Writes to both locations for maximum compatibility.
 *
 * @param {string} level - one of VALID_LEVELS
 * @returns {'saved'|'invalid'|'error'}
 */
function setDefaultLevel(level) {
  if (!level || !VALID_LEVELS.includes(level.toLowerCase())) {
    return 'invalid';
  }
  const normalized = level.toLowerCase();

  try {
    // Write to config file
    const configDir = getConfigDir();
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = getConfigPath();
    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch { /* new file */ }
    config.defaultLevel = normalized;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    // Write to plugin settings in settings.json
    try {
      let settings = {};
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      }
      if (!settings.pluginSettings) settings.pluginSettings = {};
      if (!settings.pluginSettings['enforce-mode']) settings.pluginSettings['enforce-mode'] = {};
      settings.pluginSettings['enforce-mode'].defaultLevel = normalized;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    } catch { /* settings.json write failed — config file still saved */ }

    // Update global flag file for statusline
    const flagPath = path.join(claudeDir, '.enforce-active');
    if (normalized === 'off') {
      try { fs.unlinkSync(flagPath); } catch { /* ignore */ }
    } else {
      try { fs.writeFileSync(flagPath, normalized); } catch { /* ignore */ }
    }

    return 'saved';
  } catch {
    return 'error';
  }
}

module.exports = { getDefaultLevel, setDefaultLevel, getConfigDir, getConfigPath, VALID_LEVELS };
