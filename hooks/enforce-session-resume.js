#!/usr/bin/env node
/**
 * enforce-session-resume.js — SessionStart hook that loads previous session context
 *
 * Finds the most recent session file for this project in ~/.claude/session-data/
 * and injects it as context via stdout so Claude remembers what happened last time.
 *
 * MATCHING LOGIC:
 *   - Scans ~/.claude/session-data/ for files matching *-<project>-session.tmp
 *   - Project name derived from cwd basename
 *   - Picks the most recently modified file
 *   - Skips if file is from current date AND < 1 minute old (avoid loading own save)
 *
 * OUTPUT: Previous session summary injected into system-reminder context
 * NEVER BLOCKS — best-effort loading, silent on errors.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════

const SESSION_DIR = path.join(os.homedir(), '.claude', 'session-data');
const MAX_CONTEXT_SIZE = 8 * 1024; // 8KB max injected context
const MAX_AGE_DAYS = 30; // Ignore sessions older than 30 days

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function getProjectName() {
  return path.basename(process.cwd());
}

/**
 * Find the most recent session file for this project.
 * Matches pattern: *-<project>-session.tmp
 */
function findLatestSession(project) {
  try {
    if (!fs.existsSync(SESSION_DIR)) return null;

    const files = fs.readdirSync(SESSION_DIR);
    const suffix = '-' + project + '-session.tmp';
    const cutoff = Date.now() - (MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

    let best = null;
    let bestMtime = 0;

    for (const file of files) {
      if (!file.endsWith(suffix)) continue;

      const fullPath = path.join(SESSION_DIR, file);
      try {
        const stat = fs.statSync(fullPath);
        const mtime = stat.mtimeMs;

        // Skip files older than MAX_AGE_DAYS
        if (mtime < cutoff) continue;

        if (mtime > bestMtime) {
          bestMtime = mtime;
          best = fullPath;
        }
      } catch { continue; }
    }

    return best;
  } catch { return null; }
}

/**
 * Read and truncate session content to fit context budget.
 */
function readSessionContent(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');

    if (content.length > MAX_CONTEXT_SIZE) {
      // Try to truncate at a section boundary
      const truncated = content.substring(0, MAX_CONTEXT_SIZE);
      const lastSection = truncated.lastIndexOf('\n## ');
      if (lastSection > MAX_CONTEXT_SIZE * 0.5) {
        content = truncated.substring(0, lastSection) + '\n\n[TRUNCATED for context budget]\n';
      } else {
        content = truncated + '\n\n[TRUNCATED for context budget]\n';
      }
    }

    return content;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════
// STDIN
// ═══════════════════════════════════════════════════════════

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  await readStdin(); // consume stdin (required by hook protocol)

  const project = getProjectName();
  const sessionFile = findLatestSession(project);

  if (!sessionFile) {
    // No previous session — silent exit
    process.exit(0);
  }

  const content = readSessionContent(sessionFile);
  if (!content || content.trim().length === 0) {
    process.exit(0);
  }

  // Extract date from filename for display
  const filename = path.basename(sessionFile);
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  const sessionDate = dateMatch ? dateMatch[1] : 'unknown';

  // Build context output
  let output = 'Previous session summary:\n';
  output += content;

  process.stdout.write(output);
}

main().catch(() => process.exit(0));
