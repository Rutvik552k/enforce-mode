#!/usr/bin/env node
/**
 * enforce-project-docs.js — SessionStart hook
 *
 * Checks the working directory for the three living project docs that
 * enforce-mode keeps in sync (LIVING DOCS rule):
 *   - CLAUDE.md       (project operating rules / anchor)
 *   - architecture.md (tech stack + workflow)
 *   - progress.md     (task ledger: Open / Closed tasks)
 *
 * Hooks cannot pop an interactive prompt, so this hook never creates anything.
 * If any doc is missing it injects a SessionStart context line instructing the
 * main agent to ASK the user before creating the missing file(s). Advisory only
 * — always exits 0, never blocks.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// The living docs enforce-mode tracks, with a one-line purpose used in the
// permission prompt the agent will raise.
const REQUIRED_DOCS = [
  { name: 'CLAUDE.md',       purpose: 'project operating rules / anchor' },
  { name: 'architecture.md', purpose: 'tech stack + workflow' },
  { name: 'progress.md',     purpose: 'task ledger (Open / Closed tasks)' },
];

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    // SessionStart may provide no stdin; don't hang.
    setTimeout(() => resolve({}), 200);
  });
}

async function main() {
  await readStdin(); // drain stdin; cwd is the source of truth for the check

  const cwd = process.cwd();
  const missing = [];

  for (const doc of REQUIRED_DOCS) {
    try {
      if (!fs.existsSync(path.join(cwd, doc.name))) missing.push(doc);
    } catch { /* treat unreadable as present — never block */ }
  }

  if (missing.length === 0) process.exit(0);

  const list = missing.map(d => `${d.name} (${d.purpose})`).join(', ');
  const names = missing.map(d => d.name).join(' + ');

  const output =
    '\n\n## Project Docs (missing)\n' +
    `enforce-mode keeps CLAUDE.md, architecture.md, and progress.md current. ` +
    `Missing in this project: ${list}. ` +
    `ASK the user for permission before creating ${names}; do not create them silently. ` +
    `On approval: progress.md → \`## Open Tasks\` / \`## Closed Tasks\`; ` +
    `architecture.md → tech stack + workflow. Keep them in sync thereafter.`;

  process.stdout.write(output);
  process.exit(0);
}

main().catch(() => process.exit(0));
