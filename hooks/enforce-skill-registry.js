#!/usr/bin/env node
/**
 * enforce-skill-registry.js — Shared dynamic skill discovery module
 *
 * Scans two locations for installed skills:
 *   1. ~/.claude/skills/<name>/SKILL.md          → skill name = dir name (e.g. "code-reviewer")
 *   2. ~/.claude/plugins/marketplaces/<plugin>/skills/<skill>/SKILL.md
 *                                                → skill name = plugin:skill (e.g. "ecc:tdd-workflow")
 *
 * Builds resolution maps from SKILL.md frontmatter (description + name):
 *   - extMap:      { '.ts': ['code-reviewer', 'ecc:tdd-workflow', ...] }
 *   - contentMap:  [{ keywords: ['auth','jwt'], skills: ['ecc:security-review'] }]
 *   - researchMap: [{ keywords: ['security','vulnerability'], skills: ['ecc:security-review'] }]
 *
 * Zero hardcoded skill selections — all mappings derived from installed skill metadata.
 * Zero npm dependencies — pure Node.js stdlib.
 *
 * Cache: 5-minute TTL, auto-refreshes on next call after expiry.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ═══════════════════════════════════════════════════════════════════════════
// SCAN LOCATIONS
// ═══════════════════════════════════════════════════════════════════════════

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');
const PLUGINS_DIR = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces');

// Infrastructure plugins excluded from skill discovery (not code review skills)
const EXCLUDED_PLUGINS = new Set(['enforce-mode', 'caveman', 'learned']);

// ═══════════════════════════════════════════════════════════════════════════
// KEYWORD → EXTENSION INFERENCE TABLE
// Maps keywords found in skill descriptions to applicable file extensions.
// This is inference infrastructure, NOT skill-specific hardcoding.
// ═══════════════════════════════════════════════════════════════════════════

const KEYWORD_EXT_MAP = {
  // Frontend
  'react': ['.tsx', '.jsx'], 'next.js': ['.tsx', '.ts'], 'nextjs': ['.tsx', '.ts'],
  'vue': ['.vue'], 'svelte': ['.svelte'], 'angular': ['.ts'],
  'tailwind': ['.tsx', '.jsx', '.css'], 'css': ['.css', '.scss'],
  'html': ['.html'], 'frontend': ['.tsx', '.jsx', '.ts', '.js'],
  // Backend
  'express': ['.ts', '.js'], 'fastapi': ['.py'], 'django': ['.py'],
  'flask': ['.py'], 'nestjs': ['.ts'], 'spring': ['.java'],
  'laravel': ['.php'], 'rails': ['.rb'],
  // Languages
  'typescript': ['.ts', '.tsx'], 'javascript': ['.js', '.jsx'],
  'python': ['.py'], 'golang': ['.go'],
  'rust': ['.rs'], 'kotlin': ['.kt', '.kts'], 'jvm': ['.java'],
  'swift': ['.swift'], 'dart': ['.dart'], 'flutter': ['.dart'],
  'c++': ['.cpp', '.c', '.h', '.hpp'], 'cpp': ['.cpp', '.c', '.h', '.hpp'],
  'c#': ['.cs'], 'csharp': ['.cs'], '.net': ['.cs'],
  'ruby': ['.rb'], 'php': ['.php'], 'scala': ['.scala'],
  'elixir': ['.ex', '.exs'], 'perl': ['.pl'],
  // Infrastructure
  'docker': ['Dockerfile'], 'kubernetes': ['.yaml', '.yml'],
  'terraform': ['.tf'], 'ci/cd': ['.yml', '.yaml'],
  // Data
  'sql': ['.sql'], 'postgres': ['.sql'], 'database': ['.sql'],
  'graphql': ['.graphql', '.gql'],
  // Testing (framework-specific only — generic 'test' too broad)
  'playwright': ['.ts', '.js'],
  'jest': ['.ts', '.js'], 'pytest': ['.py'],
  // Security (content-triggered via CONTENT_KEYWORDS, not extension-triggered)
  'solidity': ['.sol'], 'smart contract': ['.sol'],
};

// Short language names that need word-boundary matching to avoid false positives
// (e.g., "go" inside "django", "java" inside "javascript")
const WORD_BOUNDARY_KEYWORDS = {
  'go':   ['.go'],
  'java': ['.java'],
  'sql':  ['.sql'],
  'r':    ['.r', '.R'],
};

// Precompile regexes for word-boundary keywords
const WORD_BOUNDARY_REGEXES = {};
for (const [word, exts] of Object.entries(WORD_BOUNDARY_KEYWORDS)) {
  WORD_BOUNDARY_REGEXES[word] = { regex: new RegExp('\\b' + word + '\\b'), exts };
}

// Category → content keywords for content-based matching.
// When a skill's description matches a category, those keywords
// are used to match against file content at write time.
const CONTENT_KEYWORDS = {
  'security': ['auth', 'jwt', 'bcrypt', 'crypto', 'passport', 'oauth'],
  'database': ['prisma', 'sequelize', 'typeorm', 'knex', 'mongoose', 'sql',
               'select ', 'insert ', 'create table', 'alter table'],
  'api': ['express', 'fastapi', 'router', 'endpoint', 'rest', 'graphql'],
  'testing': ['describe', 'it(', 'test(', 'expect', 'assert', 'beforeEach'],
  'frontend': ['useState', 'useEffect', 'component', 'render', 'jsx'],
  'devops': ['docker', 'kubernetes', 'deploy', 'pipeline', 'ci/cd'],
  'prompt injection': ['openai', 'anthropic', 'langchain', 'llamaindex', 'chat.create', 'completion'],
};

// ═══════════════════════════════════════════════════════════════════════════
// SKILL ENTRY COLLECTION — scans both directories
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Collect all skill entries from installed skills and plugins.
 * Returns [{ name: string, path: string }]
 */
function collectSkillEntries() {
  const entries = [];

  // 1. ~/.claude/skills/<name>/SKILL.md → name = dir name
  try {
    if (fs.existsSync(SKILLS_DIR)) {
      const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
      for (const entry of dirs) {
        const fullPath = path.join(SKILLS_DIR, entry.name);
        let isDir = entry.isDirectory();
        if (!isDir && entry.isSymbolicLink()) {
          try { isDir = fs.statSync(fullPath).isDirectory(); } catch { continue; }
        }
        if (!isDir) continue;
        if (EXCLUDED_PLUGINS.has(entry.name)) continue;

        const skillPath = path.join(fullPath, 'SKILL.md');
        try {
          if (fs.existsSync(skillPath)) {
            entries.push({ name: entry.name, path: skillPath });
          }
        } catch { continue; }
      }
    }
  } catch { /* silent */ }

  // 2. ~/.claude/plugins/marketplaces/<plugin>/skills/<skill>/SKILL.md → name = plugin:skill
  try {
    if (fs.existsSync(PLUGINS_DIR)) {
      const plugins = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
      for (const plugin of plugins) {
        if (EXCLUDED_PLUGINS.has(plugin.name)) continue;
        const pluginPath = path.join(PLUGINS_DIR, plugin.name);
        let isDir = plugin.isDirectory();
        if (!isDir && plugin.isSymbolicLink()) {
          try { isDir = fs.statSync(pluginPath).isDirectory(); } catch { continue; }
        }
        if (!isDir) continue;

        const skillsDir = path.join(pluginPath, 'skills');
        try {
          if (!fs.existsSync(skillsDir)) continue;
          const skills = fs.readdirSync(skillsDir, { withFileTypes: true });
          for (const skill of skills) {
            const skillFullPath = path.join(skillsDir, skill.name);
            let sIsDir = skill.isDirectory();
            if (!sIsDir && skill.isSymbolicLink()) {
              try { sIsDir = fs.statSync(skillFullPath).isDirectory(); } catch { continue; }
            }
            if (!sIsDir) continue;

            const skillPath = path.join(skillFullPath, 'SKILL.md');
            try {
              if (fs.existsSync(skillPath)) {
                entries.push({ name: plugin.name + ':' + skill.name, path: skillPath });
              }
            } catch { continue; }
          }
        } catch { continue; }
      }
    }
  } catch { /* silent */ }

  return entries;
}

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC DISCOVERY — builds resolution maps from SKILL.md metadata
// ═══════════════════════════════════════════════════════════════════════════

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 300000; // 5 minutes

// Words too common/short to be useful research keywords
const STOPWORDS = new Set([
  'when', 'with', 'that', 'this', 'from', 'have', 'been', 'will', 'used',
  'your', 'code', 'skill', 'best', 'practices', 'patterns', 'using',
  'also', 'based', 'provides', 'includes', 'covers', 'work', 'make',
]);

/**
 * Discover all skills dynamically and build resolution maps.
 * Returns { extMap, contentMap, researchMap }
 */
function discoverSkills() {
  if (_cache && (Date.now() - _cacheTime) < CACHE_TTL) return _cache;

  const extMap = {};      // { '.ts': ['code-reviewer', 'ecc:tdd-workflow', ...] }
  const contentMap = [];  // [{ keywords: ['auth','jwt'], skills: ['ecc:security-review'] }]
  const researchMap = []; // [{ keywords: ['security'], skills: ['ecc:security-review'] }]

  const entries = collectSkillEntries();

  for (const { name, path: skillPath } of entries) {
    try {
      const raw = fs.readFileSync(skillPath, 'utf8').substring(0, 2000);
      const descMatch = raw.match(/description:\s*["']?(.+?)["']?\s*$/im);
      const description = descMatch ? descMatch[1].toLowerCase() : '';
      // Replace colons with spaces so "ecc:python-review" tokenizes to "ecc python review"
      const nameAndDesc = (name.replace(/:/g, ' ').replace(/-/g, ' ') + ' ' + description).toLowerCase();

      const matchedExts = new Set();
      const matchedContentKw = new Set();
      const matchedResearchKw = new Set();

      // Keyword → extension inference (simple substring)
      for (const [keyword, exts] of Object.entries(KEYWORD_EXT_MAP)) {
        if (nameAndDesc.includes(keyword)) {
          for (const ext of exts) matchedExts.add(ext);
        }
      }

      // Word-boundary keywords for short names (go, java, sql, r)
      for (const { regex, exts } of Object.values(WORD_BOUNDARY_REGEXES)) {
        if (regex.test(nameAndDesc)) {
          for (const ext of exts) matchedExts.add(ext);
        }
      }

      // Category → content keywords
      for (const [category, keywords] of Object.entries(CONTENT_KEYWORDS)) {
        if (nameAndDesc.includes(category)) {
          for (const kw of keywords) matchedContentKw.add(kw);
        }
      }

      // Research keywords from description words
      const descWords = nameAndDesc.split(/[\s,./()-]+/).filter(w => w.length > 3);
      for (const w of descWords.slice(0, 20)) {
        if (!STOPWORDS.has(w)) {
          matchedResearchKw.add(w);
        }
      }

      // Register in maps
      if (matchedExts.size > 0) {
        for (const ext of matchedExts) {
          if (!extMap[ext]) extMap[ext] = [];
          extMap[ext].push(name);
        }
      }

      if (matchedContentKw.size > 0) {
        contentMap.push({ keywords: [...matchedContentKw], skills: [name], label: name });
      }

      if (matchedResearchKw.size > 0) {
        researchMap.push({
          keywords: [...matchedResearchKw].slice(0, 10),
          skills: [name],
          label: name,
        });
      }
    } catch { continue; }
  }

  _cache = { extMap, contentMap, researchMap };
  _cacheTime = Date.now();
  return _cache;
}

// ═══════════════════════════════════════════════════════════════════════════
// SKILL RESOLUTION — public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve skills for a file write operation.
 * @param {string} filePath
 * @param {string} source - file content (used for content keyword matching)
 * @returns {string[]} skill names
 */
function resolveWriteSkills(filePath, source) {
  const skills = new Set();
  const discovery = discoverSkills();

  // Extension match
  const ext = path.extname(filePath).toLowerCase();
  const extSkills = discovery.extMap[ext];
  if (extSkills) extSkills.forEach(s => skills.add(s));

  // Filename match (Dockerfile, docker-compose.yml, etc.)
  const basename = path.basename(filePath);
  const fnSkills = discovery.extMap[basename];
  if (fnSkills) fnSkills.forEach(s => skills.add(s));

  // Content keyword match
  if (source) {
    const sourceLower = source.toLowerCase();
    for (const entry of discovery.contentMap) {
      if (entry.keywords.some(kw => sourceLower.includes(kw))) {
        entry.skills.forEach(s => skills.add(s));
      }
    }
  }

  return [...skills];
}

/**
 * Resolve skills for a research query.
 * @param {string} query
 * @returns {string[]} skill names
 */
function resolveResearchSkills(query) {
  const skills = new Set();
  const discovery = discoverSkills();
  const queryLower = query.toLowerCase();

  for (const entry of discovery.researchMap) {
    if (entry.keywords.some(kw => queryLower.includes(kw))) {
      entry.skills.forEach(s => skills.add(s));
    }
  }

  return [...skills];
}

/**
 * Clear the discovery cache (for testing).
 */
function clearRegistryCache() {
  _cache = null;
  _cacheTime = 0;
}

module.exports = {
  discoverSkills,
  resolveWriteSkills,
  resolveResearchSkills,
  collectSkillEntries,
  clearRegistryCache,
  KEYWORD_EXT_MAP,
  CONTENT_KEYWORDS,
};
