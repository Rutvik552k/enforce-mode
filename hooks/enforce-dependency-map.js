#!/usr/bin/env node
/**
 * enforce-dependency-map.js — SessionStart hook
 *
 * enforce-mode keeps a living dependency map of the project (DEPENDENCY MAP
 * rule). It is a two-file artifact at the project root:
 *   - dependency-map.json  (machine-readable source of truth: nodes + edges)
 *   - dependency-map.md    (human-readable view: Mermaid graph + per-feature tables)
 *
 * Each feature/service entry records: the operations it performs, its
 * depends-on edges (outbound), its affected-by reverse edges (inbound impact),
 * and the data contract + coupling type crossing each boundary.
 *
 * Hooks cannot pop an interactive prompt, so this hook never creates anything.
 * If either file is missing it injects a SessionStart context line instructing
 * the main agent to ASK the user before creating them, and to keep them current
 * mid-work. Advisory only — always exits 0, never blocks.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// The two files that make up the living dependency-map artifact.
const MAP_FILES = [
  { name: 'dependency-map.json', purpose: 'machine-readable nodes + edges (source of truth)' },
  { name: 'dependency-map.md',   purpose: 'human-readable Mermaid graph + per-feature tables' },
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

  for (const f of MAP_FILES) {
    try {
      if (!fs.existsSync(path.join(cwd, f.name))) missing.push(f);
    } catch { /* treat unreadable as present — never block */ }
  }

  if (missing.length === 0) process.exit(0);

  const list = missing.map(f => `${f.name} (${f.purpose})`).join(', ');
  const names = missing.map(f => f.name).join(' + ');

  const output =
    '\n\n## Dependency Map (missing)\n' +
    `enforce-mode keeps a living dependency map at the project root. ` +
    `Missing: ${list}. ` +
    `ASK the user for permission before creating ${names} via the AskUserQuestion tool (structured options, e.g. create / skip), not a free-text prompt; do not create them silently. ` +
    `On approval: dependency-map.json is the source of truth (nodes = features/services; each carries operations, depends-on edges, affected-by reverse edges, and data-contract + coupling type per boundary); ` +
    `dependency-map.md is the generated human view (Mermaid graph + per-feature tables). ` +
    `Keep both in sync the instant any feature, operation, edge, or contract changes — including mid-task, not only at task end. Never put secrets in the map.`;

  process.stdout.write(output);
  process.exit(0);
}

main().catch(() => process.exit(0));
