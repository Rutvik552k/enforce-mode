#!/usr/bin/env node
/**
 * enforce-skill-auto-loader.js — PreToolUse hook for AUTO skill injection
 *
 * DYNAMIC DISCOVERY + CACHING:
 *   - Scans ~/.claude/skills/ at startup, reads SKILL.md frontmatter
 *   - Auto-builds BM25 corpus from skill descriptions (no hardcoded maps)
 *   - Caches corpus + summaries in OS temp dir (invalidates on dir mtime change)
 *   - New skills installed → auto-discovered on next cache rebuild
 *
 * MATCHING PIPELINE (tiered):
 *   Tier 1: Exact extension/filename match (static, fast — kept for precision)
 *   Tier 2: BM25-lite token scoring against dynamic corpus
 *   Tier 3: Content pattern regex (high-value patterns kept static)
 *
 * AUTO-INJECTION:
 *   - Injects compressed skill summary as additionalContext
 *   - No Claude cooperation needed — zero evasion possible
 *   - Max 2 skills × ~800 chars per call
 *
 * PERFORMANCE:
 *   - Cache hit: ~5ms (read JSON, score, inject)
 *   - Cache miss: ~50-80ms (scan 69 skills, build corpus, write cache)
 *   - Node startup: ~60ms overhead (unavoidable)
 *
 * CONSTRAINTS:
 *   - Zero npm dependencies (pure Node.js stdlib)
 *   - Must complete within 5s timeout
 *   - Context budget: max ~1.6KB injected (2 skills × 800 chars)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { isSkippedExtension, isExemptFilePath } = require('./enforce-state');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const MAX_SKILLS_INJECTED = 2;
const MAX_SUMMARY_CHARS = 800;
const BM25_THRESHOLD = 0.20;
const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');
const CACHE_FILE = path.join(os.tmpdir(), 'enforce-skill-cache.json');
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min TTL (covers skill installs)

// BM25 parameters
const BM25_K1 = 1.2;
const BM25_B = 0.75;

// ═══════════════════════════════════════════════════════════════════════════
// TOOL GROUPS + GATES
// ═══════════════════════════════════════════════════════════════════════════

const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit'];
const RESEARCH_TOOLS = ['WebSearch', 'WebFetch', 'Agent'];
const ALL_TRIGGER_TOOLS = [...WRITE_TOOLS, ...RESEARCH_TOOLS];

// SKIP_EXTENSIONS + EXEMPT_PATHS: now centralized in enforce-state.js

function isCodeFile(fp) {
  return fp && !isSkippedExtension(fp);
}

// ═══════════════════════════════════════════════════════════════════════════
// TIER 1: STATIC EXTENSION/FILENAME MAP (kept for speed + precision)
// ═══════════════════════════════════════════════════════════════════════════

const EXT_SKILL_MAP = {
  '.ts': ['ecc:code-review', 'ecc:tdd-workflow'],
  '.tsx': ['ecc:code-review', 'ecc:senior-frontend'],
  '.js': ['ecc:code-review', 'ecc:tdd-workflow'],
  '.jsx': ['ecc:code-review', 'ecc:senior-frontend'],
  '.py': ['ecc:python-review', 'ecc:tdd-workflow'],
  '.go': ['ecc:go-review', 'ecc:go-test'],
  '.rs': ['ecc:rust-review', 'ecc:rust-test'],
  '.kt': ['ecc:kotlin-review', 'ecc:kotlin-test'],
  '.java': ['ecc:code-review', 'ecc:tdd-workflow'],
  '.cs': ['ecc:code-review', 'ecc:tdd-workflow'],
  '.dart': ['ecc:flutter-review', 'ecc:flutter-test'],
  '.cpp': ['ecc:cpp-review', 'ecc:cpp-test'],
  '.c': ['ecc:cpp-review', 'ecc:cpp-test'],
  '.h': ['ecc:cpp-review'],
  '.hpp': ['ecc:cpp-review'],
  '.swift': ['ecc:code-review'],
  '.sql': ['ecc:postgres-patterns'],
  '.sol': ['ecc:security-review'],
  '.tf': ['ecc:senior-devops', 'ecc:deployment-patterns'],
  // Additional languages
  '.rb': ['ecc:code-review'],
  '.php': ['ecc:code-review'],
  '.scala': ['ecc:code-review'],
  '.ex': ['ecc:code-review'],
  '.exs': ['ecc:code-review'],
  '.lua': ['ecc:code-review'],
  '.r': ['ecc:code-review'],
  '.R': ['ecc:code-review'],
  '.jl': ['ecc:code-review'],
  '.groovy': ['ecc:code-review'],
  '.pl': ['ecc:code-review'],
};

const FILENAME_SKILL_MAP = {
  'Dockerfile': ['ecc:docker-patterns', 'ecc:senior-devops'],
  'docker-compose.yml': ['ecc:docker-patterns', 'ecc:senior-devops'],
  'docker-compose.yaml': ['ecc:docker-patterns', 'ecc:senior-devops'],
};

// ═══════════════════════════════════════════════════════════════════════════
// TIER 3: STATIC CONTENT PATTERNS (high-precision, kept for reliability)
// ═══════════════════════════════════════════════════════════════════════════

const CONTENT_PATTERNS = [
  { regex: /(?:jwt|bcrypt|crypto|auth|login|session|oauth|password)/i,
    skill: 'security-pen-testing' },
  { regex: /(?:prisma|sequelize|typeorm|knex|mongoose|\.query|\.execute|SELECT\s|INSERT\s)/,
    skill: 'postgres-patterns' },
  { regex: /^FROM\s+\w+|^RUN\s+/m,
    skill: 'docker-patterns' },
  { regex: /(?:CREATE\s+TABLE|ALTER\s+TABLE|migration|knex\.schema)/i,
    skill: 'database-migrations' },
  { regex: /(?:describe|it|test|expect|assert|beforeEach|afterEach)\s*\(/,
    skill: 'tdd-guide' },
  { regex: /(?:playwright|page\.goto|page\.click|cy\.|cypress)/i,
    skill: 'e2e-testing' },
  { regex: /(?:useState|useEffect|useContext|getServerSideProps|getStaticProps)/,
    skill: 'senior-frontend' },
  { regex: /(?:app\.(get|post|put|delete)|@(Get|Post|Put|Delete)\(|router\.(get|post))/,
    skill: 'senior-backend' },
  { regex: /(?:openai|anthropic|langchain|llamaindex|@ai-sdk|completion|chat\.create)/i,
    skill: 'ai-security' },
];

// ═══════════════════════════════════════════════════════════════════════════
// TOKENIZER (shared between corpus builder and runtime matching)
// ═══════════════════════════════════════════════════════════════════════════

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'if', 'or', 'and', 'but', 'nor', 'yet', 'this', 'that', 'these', 'those',
  'it', 'its', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him',
  'his', 'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who',
  'whom', 'new', 'true', 'false', 'null', 'undefined', 'var', 'let', 'const',
  'return', 'import', 'export', 'function', 'require', 'use', 'using',
  'skill', 'when', 'user', 'asks', 'code', 'based', 'provides', 'includes',
]);

function tokenize(text) {
  if (!text) return [];
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9-]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOPWORDS.has(w));
}

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC CORPUS CACHE — build from disk, cache to temp file
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cache structure:
 * {
 *   version: 2,
 *   builtAt: timestamp,
 *   skillsDir: string,
 *   corpus: { [skillDir]: { tokens: string[], summary: string } },
 *   avgDocLen: number,
 * }
 */

function isCacheValid() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return false;
    const stat = fs.statSync(CACHE_FILE);
    const age = Date.now() - stat.mtimeMs;
    if (age > CACHE_TTL_MS) return false;

    // Check if skills dir was modified after cache
    const dirStat = fs.statSync(SKILLS_DIR);
    if (dirStat.mtimeMs > stat.mtimeMs) return false;

    return true;
  } catch { return false; }
}

function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data.version !== 2) return null;
    return data;
  } catch { return null; }
}

function buildCorpus() {
  const corpus = {};
  let dirs;

  try {
    dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch { return { version: 2, builtAt: Date.now(), skillsDir: SKILLS_DIR, corpus: {}, avgDocLen: 0 }; }

  for (const entry of dirs) {
    // Support both real dirs and symlinks (Windows: isDirectory()=false for symlinks)
    const fullPath = path.join(SKILLS_DIR, entry.name);
    let isDir = entry.isDirectory();
    if (!isDir && entry.isSymbolicLink()) {
      try { isDir = fs.statSync(fullPath).isDirectory(); } catch { /* ignore */ }
    }
    if (!isDir) continue;
    const skillDir = entry.name;
    const skillPath = path.join(SKILLS_DIR, skillDir, 'SKILL.md');

    try {
      if (!fs.existsSync(skillPath)) continue;
      const raw = fs.readFileSync(skillPath, 'utf8');

      // Extract description from frontmatter
      const description = extractDescription(raw);
      if (!description) continue;

      // Extract triggers for extra matching terms
      const triggers = extractTriggers(raw);

      // Tokenize description + triggers → corpus terms
      const descTokens = tokenize(description);
      const triggerTokens = tokenize(triggers.join(' '));
      const tokens = [...new Set([...descTokens, ...triggerTokens])];
      if (tokens.length < 2) continue; // skip trivially short

      // Extract summary for injection
      const summary = extractSummary(raw, description);

      corpus[skillDir] = { tokens, summary };
    } catch { continue; }
  }

  // Compute average doc length
  const lengths = Object.values(corpus).map(c => c.tokens.length);
  const avgDocLen = lengths.length > 0
    ? lengths.reduce((a, b) => a + b, 0) / lengths.length
    : 10;

  const cacheData = {
    version: 2,
    builtAt: Date.now(),
    skillsDir: SKILLS_DIR,
    corpus,
    avgDocLen,
  };

  // Write cache (non-blocking, best-effort)
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData)); } catch { /* ignore */ }

  return cacheData;
}

function getCorpus() {
  if (isCacheValid()) {
    const cached = loadCache();
    if (cached) return cached;
  }
  return buildCorpus();
}

// ═══════════════════════════════════════════════════════════════════════════
// FRONTMATTER + SUMMARY EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

function extractDescription(raw) {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return '';
  const fm = fmMatch[1];

  // Find description field start
  const descStart = fm.match(/^description:\s*(.*)$/im);
  if (!descStart) return '';

  const firstLine = descStart[1].trim();
  const descIdx = fm.indexOf(descStart[0]) + descStart[0].length;

  // Handle YAML block scalars (> or |) and quoted strings
  if (firstLine === '>' || firstLine === '|' || firstLine === '') {
    // Multi-line: collect indented continuation lines
    const rest = fm.slice(descIdx);
    const lines = rest.split('\n');
    const descLines = [];
    for (const line of lines) {
      // Indented continuation or empty line within block
      if (line.match(/^\s{2,}/) || line.trim() === '') {
        descLines.push(line.trim());
      } else {
        break; // hit next YAML key
      }
    }
    return descLines.join(' ').replace(/\s+/g, ' ').trim();
  }

  // Single-line (possibly quoted)
  return firstLine.replace(/^["'>|]\s*/, '').replace(/["']\s*$/, '').trim();
}

/**
 * Extract triggers list from frontmatter (if present).
 * Returns array of trigger strings.
 */
function extractTriggers(raw) {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const fm = fmMatch[1];

  const trigStart = fm.match(/^triggers:\s*$/im);
  if (!trigStart) return [];

  const trigIdx = fm.indexOf(trigStart[0]) + trigStart[0].length;
  const rest = fm.slice(trigIdx);
  const lines = rest.split('\n');
  const triggers = [];

  for (const line of lines) {
    const match = line.match(/^\s+-\s+(.+)/);
    if (match) {
      triggers.push(match[1].trim().replace(/["']/g, ''));
    } else if (!line.match(/^\s*$/) && !line.match(/^\s+-/)) {
      break; // hit next YAML key
    }
  }
  return triggers;
}

function extractSummary(raw, description) {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;

  // Find actionable section
  const sectionHeaders = [
    /^#{2,3}\s+.*(?:rules|guidelines|checklist|must|key\s|best\spractices)/im,
    /^#{2,3}\s+.*(?:core\s+capabilities|overview|main|quick\sstart)/im,
    /^#{2,3}\s+.*(?:what|how|when|patterns|conventions|anti.?patterns)/im,
  ];

  let sectionContent = '';
  for (const pattern of sectionHeaders) {
    const match = body.match(pattern);
    if (match) {
      const start = body.indexOf(match[0]) + match[0].length;
      const rest = body.slice(start);
      const nextSection = rest.search(/\n#{2,3}\s+/);
      const section = nextSection > 0 ? rest.slice(0, nextSection) : rest.slice(0, 800);

      // Extract bullets and short paragraphs
      sectionContent = section.split('\n')
        .filter(l => l.match(/^[-*]\s+|^\d+\.\s+|^[A-Z]/) && l.trim().length > 5)
        .slice(0, 10)
        .join('\n')
        .slice(0, 500);
      break;
    }
  }

  if (!sectionContent) {
    // Fallback: first bullet list
    const bulletMatch = body.match(/^[-*]\s+.+(\n[-*]\s+.+)*/m);
    if (bulletMatch) sectionContent = bulletMatch[0].slice(0, 500);
  }

  let summary = description.slice(0, 200);
  if (sectionContent) summary += '\n' + sectionContent;
  return summary.slice(0, MAX_SUMMARY_CHARS);
}

// ═══════════════════════════════════════════════════════════════════════════
// BM25-LITE SCORING (against dynamic corpus)
// ═══════════════════════════════════════════════════════════════════════════

function bm25Score(queryTokens, skillTokens, corpusSize, avgDocLen, dfMap) {
  if (!queryTokens.length || !skillTokens.length) return 0;

  const skillTermSet = new Set(skillTokens);
  const docLen = skillTokens.length;
  let score = 0;

  // Deduplicate query tokens for scoring
  const seen = new Set();
  for (const term of queryTokens) {
    if (seen.has(term)) continue;
    seen.add(term);

    if (!skillTermSet.has(term)) continue;

    // IDF from precomputed document frequency map
    const df = dfMap[term] || 1;
    const idf = Math.log((corpusSize - df + 0.5) / (df + 0.5) + 1);

    // TF: binary (1 if present in skill tokens)
    const tf = 1;
    const numerator = tf * (BM25_K1 + 1);
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgDocLen));
    score += idf * (numerator / denominator);
  }

  // Normalize
  const maxScore = Math.max(queryTokens.length * 1.5, 1);
  return Math.min(score / maxScore, 1.0);
}

/**
 * Build document frequency map from corpus (how many skills contain each term).
 * Called once per execution — O(total_terms).
 */
function buildDFMap(corpus) {
  const dfMap = {};
  for (const { tokens } of Object.values(corpus)) {
    const unique = new Set(tokens);
    for (const t of unique) {
      dfMap[t] = (dfMap[t] || 0) + 1;
    }
  }
  return dfMap;
}

function bm25Match(queryTokens, cacheData) {
  const { corpus, avgDocLen } = cacheData;
  const corpusSize = Object.keys(corpus).length;
  if (corpusSize === 0) return [];

  const dfMap = buildDFMap(corpus);
  const results = [];

  for (const [skillDir, { tokens }] of Object.entries(corpus)) {
    const score = bm25Score(queryTokens, tokens, corpusSize, avgDocLen, dfMap);
    if (score >= BM25_THRESHOLD) {
      results.push({ skill: skillDir, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 10); // top 10 candidates max
}

// ═══════════════════════════════════════════════════════════════════════════
// SKILL RESOLUTION (3-tier pipeline)
// ═══════════════════════════════════════════════════════════════════════════

function resolveSkills(filePath, source, cacheData) {
  const candidates = new Map();

  // Tier 1: Extension match (score 1.0)
  const ext = path.extname(filePath).toLowerCase();
  const extSkills = EXT_SKILL_MAP[ext] || [];
  for (const s of extSkills) {
    candidates.set(s, { score: 1.0, source: 'extension' });
  }

  // Tier 1b: Filename match (score 1.0)
  const basename = path.basename(filePath);
  const fnSkills = FILENAME_SKILL_MAP[basename] || [];
  for (const s of fnSkills) {
    if (!candidates.has(s)) candidates.set(s, { score: 1.0, source: 'filename' });
  }

  // Tier 2: BM25 dynamic scoring (limit input to 5KB for speed)
  const tokens = tokenize(source.slice(0, 5000));
  if (tokens.length > 0) {
    const bm25Results = bm25Match(tokens, cacheData);
    for (const { skill, score } of bm25Results) {
      const existing = candidates.get(skill);
      if (!existing || existing.score < score) {
        candidates.set(skill, { score, source: 'bm25' });
      }
    }
  }

  // Tier 3: Content regex (score 0.95)
  for (const { regex, skill } of CONTENT_PATTERNS) {
    if (regex.test(source)) {
      const existing = candidates.get(skill);
      if (!existing || existing.score < 0.95) {
        candidates.set(skill, { score: 0.95, source: 'content-pattern' });
      }
    }
  }

  // Sort: content-specific > bm25 > generic extension
  const SOURCE_PRIORITY = { 'content-pattern': 3, 'bm25': 2, 'extension': 1, 'filename': 1 };
  return [...candidates.entries()]
    .map(([skill, data]) => ({ skill, ...data }))
    .sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.1) return b.score - a.score;
      return (SOURCE_PRIORITY[b.source] || 0) - (SOURCE_PRIORITY[a.source] || 0);
    });
}

function resolveResearchSkills(query, cacheData) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const results = bm25Match(tokens, cacheData);
  return results.map(({ skill, score }) => ({ skill, score, source: 'bm25' }));
}

// ═══════════════════════════════════════════════════════════════════════════
// SESSION DEDUP
// ═══════════════════════════════════════════════════════════════════════════

function getInjectionState(sessionId) {
  const stateFile = path.join(os.tmpdir(), `enforce-auto-skill-${sessionId}.json`);
  try {
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
  } catch { /* ignore */ }
  return { injected: [], count: 0 };
}

function recordInjection(sessionId, skills) {
  const stateFile = path.join(os.tmpdir(), `enforce-auto-skill-${sessionId}.json`);
  const state = getInjectionState(sessionId);
  for (const s of skills) {
    if (!state.injected.includes(s)) state.injected.push(s);
  }
  state.count++;
  try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// STDIN
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const input = await readStdin();
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const sessionId = input.session_id || 'default';

  // Gate: only trigger tools
  if (!ALL_TRIGGER_TOOLS.includes(toolName)) process.exit(0);

  // Load or build corpus (cached — fast path ~2ms)
  const cacheData = getCorpus();

  let ranked = [];
  let filePath = '';

  if (WRITE_TOOLS.includes(toolName)) {
    filePath = toolInput.file_path || toolInput.notebook_path || '';
    const source = toolInput.content || toolInput.new_source || toolInput.new_string || '';

    if (!filePath || !source) process.exit(0);
    if (isExemptFilePath(filePath, true)) process.exit(0); // skillLoaderMode=true
    if (!isCodeFile(filePath)) process.exit(0);
    if (source.length < 5) process.exit(0);

    ranked = resolveSkills(filePath, source, cacheData);
  } else {
    const query = toolInput.query || toolInput.url || toolInput.prompt
      || toolInput.description || toolInput.command || '';
    if (!query) process.exit(0);

    ranked = resolveResearchSkills(query, cacheData);
  }

  if (ranked.length === 0) process.exit(0);

  // Dedup: skip skills already injected this session
  const state = getInjectionState(sessionId);
  const fresh = ranked.filter(r => !state.injected.includes(r.skill));
  const toInject = (fresh.length > 0 ? fresh : ranked).slice(0, MAX_SKILLS_INJECTED);

  // Load summaries (from cache — no disk reads on hot path)
  const summaries = [];
  for (const { skill, score, source } of toInject) {
    const cached = cacheData.corpus[skill];
    if (cached && cached.summary) {
      summaries.push({ skill, score, source, summary: cached.summary });
    }
  }

  if (summaries.length === 0) {
    const names = toInject.slice(0, 3).map(s => s.skill).join(', ');
    const out = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `[AUTO-SKILL] Matched: ${names} (no summary cached — consider /ecc:${toInject[0].skill})`,
      }
    };
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }

  // Record injections for dedup
  recordInjection(sessionId, summaries.map(s => s.skill));

  // Build injection context
  const parts = summaries.map(({ skill, score, source, summary }) =>
    `━━ ${skill} (${source}, score:${score.toFixed(2)}) ━━\n${summary}`
  );

  const injection = `[AUTO-SKILL INJECTED]\n${parts.join('\n\n')}`;

  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: injection,
    }
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write('AUTO-SKILL-LOADER ERROR: ' + e.message);
  process.exit(0);
});
