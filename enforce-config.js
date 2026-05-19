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
 *   3. 'solo'
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const VALID_LEVELS = ['off', 'solo', 'team', 'prod'];

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

  // 3. Default
  return 'solo';
}

module.exports = { getDefaultLevel, getConfigDir, getConfigPath, VALID_LEVELS };
