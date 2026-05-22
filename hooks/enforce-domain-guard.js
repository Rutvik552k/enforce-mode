#!/usr/bin/env node
/**
 * enforce-domain-guard.js — PECK v3 domain-specific pattern guard
 *
 * Unified PreToolUse hook for Write|Edit|NotebookEdit.
 *
 * v3 changes over v2:
 *   - Modular domain loading from hooks/domains/*.js
 *   - Per-pattern severity field (WARN|STRICT|CRITICAL) for level filtering
 *   - Per-pattern-per-file deduplication (Change 1)
 *   - Cross-domain overlap prevention (Change 2)
 *   - Inline suppression comments: // enforce-ignore: pattern-name (Change 3)
 *   - Pre-compiled multiline regexes at module load (Change 4)
 *   - Early exit on small source (Change 5)
 *   - Level-aware tier capping (Change 14)
 *
 * DESIGN PRINCIPLES (FP/FN reduction):
 *   - HIGH confidence: structural patterns with prefix/suffix anchors
 *   - MEDIUM confidence: syntactic features with legitimate edge cases
 *   - LOW confidence: absence detection (missing X), high context dependence
 *   - Every pattern has justificationKeywords that suppress when found nearby
 *   - severity controls WHEN a pattern enforces (solo/team/prod)
 *   - confidence controls HOW HARD it enforces (PECK weight)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { isActive, getLevel, peckEvaluateV2, peckTick, peckRecordComplianceV2 } = require('./enforce-state');

// ═══════════════════════════════════════════════════════════════════════════
// v3: MODULAR DOMAIN PATTERN LOADING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load domain patterns from hooks/domains/*.js files.
 * Each module exports: { domain, patterns, extMap }
 * Falls back to built-in BUILTIN_PATTERNS if no modules found.
 */
function loadDomainModules() {
  const domainsDir = path.join(__dirname, 'domains');
  const allPatterns = {};
  const allExtMap = {};

  // Load modular domains
  try {
    if (fs.existsSync(domainsDir)) {
      const files = fs.readdirSync(domainsDir).filter(f => f.endsWith('.js'));
      for (const file of files) {
        try {
          const mod = require(path.join(domainsDir, file));
          if (mod.domain && Array.isArray(mod.patterns)) {
            // Pre-compile multiline regexes at load time (Change 4)
            allPatterns[mod.domain] = mod.patterns.map(pat => {
              if (pat.multiline && pat.regex) {
                const flags = pat.regex.flags + (pat.regex.flags.includes('s') ? '' : 's');
                return { ...pat, _compiledRegex: new RegExp(pat.regex.source, flags) };
              }
              return { ...pat, _compiledRegex: pat.regex };
            });
            // Merge extension map
            if (mod.extMap) {
              Object.assign(allExtMap, mod.extMap);
            }
          }
        } catch { /* skip broken module */ }
      }
    }
  } catch { /* domains dir doesn't exist */ }

  // Fall back to built-in if no modules loaded
  if (Object.keys(allPatterns).length === 0) {
    for (const [domain, patterns] of Object.entries(BUILTIN_PATTERNS)) {
      allPatterns[domain] = patterns.map(pat => {
        if (pat.multiline && pat.regex) {
          const flags = pat.regex.flags + (pat.regex.flags.includes('s') ? '' : 's');
          return { ...pat, _compiledRegex: new RegExp(pat.regex.source, flags) };
        }
        return { ...pat, _compiledRegex: pat.regex };
      });
    }
    Object.assign(allExtMap, BUILTIN_EXT_MAP);
  }

  return { patterns: allPatterns, extMap: allExtMap };
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILT-IN PATTERNS (backward compat — used when hooks/domains/ is empty)
// v3: Added severity field to every pattern
// ═══════════════════════════════════════════════════════════════════════════

const BUILTIN_PATTERNS = {
  // ─── BLOCKCHAIN ───
  blockchain: [
    {
      name: 'Reentrancy: external call before state update',
      regex: /\.call\{[^}]*\}\s*\([^)]*\)[\s\S]{0,200}(?:balances|balance|amounts?|state)\s*[\[.=]/,
      risk: 'Reentrancy vulnerability — state change after external call. Use CEI pattern.',
      confidence: 'HIGH', severity: 'STRICT',
      multiline: true,
      justification: ['CEI', 'nonReentrant', 'ReentrancyGuard', 'checks-effects-interactions'],
    },
    {
      name: 'Unchecked external call',
      regex: /\(bool\s+\w*,?\s*\)\s*=\s*\w+\.call\{[^}]*\}\([^)]*\);(?!\s*require|\s*if\s*\()/,
      risk: 'External call return value not checked — silent failure.',
      confidence: 'HIGH', severity: 'STRICT',
      multiline: false,
      justification: ['require(success', 'if (!success', 'if (success)', 'SafeTransferLib'],
    },
    {
      name: 'Unbounded loop over dynamic array',
      regex: /for\s*\(\s*uint\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*\w+\.length\s*;/,
      risk: 'Gas-unbounded loop — DoS if array grows. Cap with MAX_LENGTH.',
      confidence: 'MEDIUM', severity: 'WARN',
      multiline: false,
      justification: ['MAX_LENGTH', 'MAX_USERS', 'bounded', 'gas:', 'maxIterations'],
    },
    {
      name: 'tx.origin for authentication',
      regex: /require\s*\(\s*tx\.origin\s*==|if\s*\(\s*tx\.origin\s*[!=]/,
      risk: 'tx.origin vulnerable to phishing attacks. Use msg.sender.',
      confidence: 'HIGH', severity: 'CRITICAL',
      multiline: false,
      justification: ['msg.sender', 'Ownable', 'onlyOwner'],
    },
  ],

  // ─── FRONTEND ───
  frontend: [
    {
      name: 'dangerouslySetInnerHTML without sanitization',
      regex: /dangerouslySetInnerHTML\s*[:=]\s*\{\s*__html\s*:/,
      risk: 'XSS via unsanitized HTML injection. Use DOMPurify.sanitize().',
      confidence: 'MEDIUM', severity: 'STRICT',
      multiline: false,
      justification: ['DOMPurify', 'sanitize', 'xss', 'purify', 'trusted HTML'],
    },
    {
      name: 'List render without key prop',
      regex: /\.map\s*\([^)]*\)\s*(?:=>|{)\s*(?:<|\(?\s*<)[A-Z]\w*/,
      risk: 'Missing key prop — React reconciliation bugs, state leaks.',
      confidence: 'LOW', severity: 'WARN',
      multiline: true,
      justification: ['key={', 'key=', 'keyExtractor'],
    },
    {
      name: 'useEffect with empty deps but using external values',
      regex: /useEffect\s*\(\s*\(\)\s*=>\s*\{[^}]{20,}\}\s*,\s*\[\s*\]\s*\)/,
      risk: 'Empty dependency array with captured variables — stale closure risk.',
      confidence: 'LOW', severity: 'WARN',
      multiline: true,
      justification: ['eslint-disable', 'exhaustive-deps', 'intentionally empty', 'mount only'],
    },
    {
      name: 'Image without alt attribute',
      regex: /<img\s+(?:(?!alt=)[^>])*\/?>/,
      risk: 'Accessibility violation — images need alt text for screen readers.',
      confidence: 'MEDIUM', severity: 'WARN',
      multiline: false,
      justification: ['alt=', 'aria-label', 'role="presentation"', 'decorative'],
    },
    {
      name: 'localStorage for auth tokens',
      regex: /localStorage\.setItem\s*\(\s*['"](?:token|auth|jwt|session|access_token)/i,
      risk: 'Auth tokens in localStorage vulnerable to XSS. Use httpOnly cookies.',
      confidence: 'HIGH', severity: 'CRITICAL',
      multiline: false,
      justification: ['httpOnly', 'secure cookie', 'CSRF token', 'dev only'],
    },
  ],

  // ─── MOBILE ───
  mobile: [
    {
      name: 'Event listener without cleanup',
      regex: /addEventListener\s*\(\s*['"][^'"]+['"]\s*,\s*\w+\s*\)(?![\s\S]{0,100}removeEventListener)/,
      risk: 'Memory leak — listener not removed on unmount/dispose.',
      confidence: 'MEDIUM', severity: 'WARN',
      multiline: true,
      justification: ['removeEventListener', 'cleanup', 'dispose', 'unsubscribe', 'return ()'],
    },
    {
      name: 'Synchronous file/DB operation on main thread',
      regex: /(?:readFileSync|writeFileSync|execSync|SQLite\.execute)\s*\(/,
      risk: 'Blocking main thread — causes UI jank and ANR.',
      confidence: 'MEDIUM', severity: 'STRICT',
      multiline: false,
      justification: ['Worker', 'async', 'dispatch_async', 'background', 'Isolate'],
    },
    {
      name: 'Location/camera access without permission check',
      regex: /(?:getCurrentPosition|requestLocation|getPhoto|launchCamera)\s*\(/,
      risk: 'Accessing hardware without permission check — crash on denial.',
      confidence: 'LOW', severity: 'WARN',
      multiline: false,
      justification: ['checkPermission', 'requestPermission', 'hasPermission', 'authorization'],
    },
    {
      name: 'setInterval without cleanup reference',
      regex: /setInterval\s*\([^)]+\)(?!\s*(?:const|let|var)\s+\w+\s*=|\s*;\s*return)/,
      risk: 'Interval without cleanup reference — memory leak, battery drain.',
      confidence: 'LOW', severity: 'WARN',
      multiline: false,
      justification: ['clearInterval', 'cleanup', 'return () =>', 'componentWillUnmount'],
    },
  ],

  // ─── RESEARCH PAPER ───
  'research-paper': [
    {
      name: 'SOTA claim without citation',
      regex: /(?:state.of.the.art|SOTA|outperforms?|surpass|novel|first\s+to)\b(?![\s\S]{0,50}\\cite|[\s\S]{0,50}\[\d)/,
      risk: 'Performance claim without citation — unverifiable.',
      confidence: 'MEDIUM', severity: 'STRICT',
      multiline: false,
      justification: ['\\cite{', '[1]', '(2024)', '(2023)', 'et al.', 'Table \\ref'],
    },
    {
      name: 'Results without error bars or std',
      regex: /(?:accuracy|F1|precision|recall|BLEU|ROUGE)\s*[:=]\s*\d+\.?\d*(?!\s*[±\\]|\s*\(|\s*\+)/,
      risk: 'Single-point metric without variance — unreproducible.',
      confidence: 'LOW', severity: 'WARN',
      multiline: false,
      justification: ['±', '\\pm', 'std', 'CI', 'p<', 'p =', 'n=', 'averaged over'],
    },
    {
      name: 'Experiment without random seed',
      regex: /(?:experiment|training|evaluation)\s*(?:config|setup|protocol)[\s\S]{0,200}(?!seed|random_state|manual_seed)/i,
      risk: 'No random seed documented — results not reproducible.',
      confidence: 'LOW', severity: 'WARN',
      multiline: true,
      justification: ['seed', 'random_state', 'manual_seed', 'deterministic', 'torch.manual_seed'],
    },
  ],

  // ─── MODEL TRAINING ───
  training: [
    {
      name: 'Learning rate without validation or schedule',
      regex: /(?:Adam|SGD|AdamW|RMSprop)\s*\([^)]*lr\s*=\s*[\d.e-]+[^)]*\)(?![\s\S]{0,100}(?:scheduler|warmup|lr_find|OneCycleLR))/,
      risk: 'Fixed LR without schedule or validation — risk of divergence.',
      confidence: 'MEDIUM', severity: 'STRICT',
      multiline: true,
      justification: ['scheduler', 'warmup', 'lr_find', 'OneCycleLR', 'CosineAnnealing', 'validated'],
    },
    {
      name: 'Training without validation split',
      regex: /\.fit\s*\([^)]*\)(?![\s\S]{0,150}(?:validation|val_split|eval|test_size))/,
      risk: 'Training without validation — overfitting undetected.',
      confidence: 'MEDIUM', severity: 'STRICT',
      multiline: true,
      justification: ['validation_split', 'val_loader', 'eval_dataset', 'test_size', 'cross_val'],
    },
    {
      name: 'No checkpoint saving in training loop',
      regex: /(?:for\s+epoch|num_epochs|training_loop)[\s\S]{0,500}(?!(?:save_checkpoint|model\.save|torch\.save|save_pretrained))/,
      risk: 'Training without checkpointing — progress lost on interruption.',
      confidence: 'LOW', severity: 'WARN',
      multiline: true,
      justification: ['save_checkpoint', 'torch.save', 'save_pretrained', 'ModelCheckpoint', 'every'],
    },
    {
      name: 'No gradient clipping',
      regex: /(?:loss\.backward|backward)\s*\(\)[\s\S]{0,100}(?:optimizer\.step|step\(\))(?![\s\S]{0,100}clip_grad)/,
      risk: 'No gradient clipping — risk of exploding gradients.',
      confidence: 'LOW', severity: 'WARN',
      multiline: true,
      justification: ['clip_grad_norm', 'clip_grad_value', 'max_grad_norm', 'gradient_clip'],
    },
  ],

  // ─── BOOK GENERATION ───
  book: [
    {
      name: 'Chapter reference to non-existent section',
      regex: /(?:see|refer to|covered in|described in)\s+(?:Chapter|Section|Part)\s+\d+/i,
      risk: 'Cross-reference may point to non-existent section. Verify target exists.',
      confidence: 'LOW', severity: 'WARN',
      multiline: false,
      justification: ['verified', 'exists', 'TOC line', 'see above', 'previous section'],
    },
    {
      name: 'Heading level skip',
      regex: /^#{1,2}\s+.+\n(?:(?!^#{1,4}\s)[\s\S])*?^#{4,6}\s+/m,
      risk: 'Heading hierarchy skips levels (H2 → H4) — breaks document structure.',
      confidence: 'MEDIUM', severity: 'STRICT',
      multiline: true,
      justification: ['hierarchy:', 'intentional', 'sidebar', 'aside', 'callout'],
    },
    {
      name: 'TODO/FIXME in content',
      regex: /(?:TODO|FIXME|PLACEHOLDER|TBD|DRAFT|XXX)(?:\s*:|\s+\w)/,
      risk: 'Incomplete content marker — not ready for publication.',
      confidence: 'HIGH', severity: 'CRITICAL',
      multiline: false,
      justification: ['WIP', 'internal draft', 'dev notes', 'not published'],
    },
  ],
};

const BUILTIN_EXT_MAP = {
  '.sol': 'blockchain', '.vy': 'blockchain',
  '.tsx': 'frontend', '.jsx': 'frontend', '.vue': 'frontend', '.svelte': 'frontend',
  '.swift': 'mobile', '.kt': 'mobile', '.dart': 'mobile',
  '.tex': 'research-paper', '.bib': 'research-paper',
  '.ipynb': 'training',
  '.md': 'book', '.rst': 'book', '.adoc': 'book',
};

// ═══════════════════════════════════════════════════════════════════════════
// LOAD DOMAINS AT MODULE INIT (cached)
// ═══════════════════════════════════════════════════════════════════════════

const { patterns: DOMAIN_PATTERNS, extMap: EXT_TO_DOMAIN } = loadDomainModules();

// ═══════════════════════════════════════════════════════════════════════════
// JUSTIFICATION CHECK (v3: + inline suppression)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if justification keywords or inline suppression present near match.
 * v3: Also checks for // enforce-ignore: pattern-name comments (Change 3)
 */
function hasJustification(source, matchIndex, keywords, patternName) {
  if (!source || matchIndex < 0) return false;

  const start = Math.max(0, matchIndex - 200);
  const end = Math.min(source.length, matchIndex + 200);
  const region = source.substring(start, end).toLowerCase();

  // v3: Check inline suppression comments
  // Look for enforce-ignore in the 2 lines above the match
  const lineStart = source.lastIndexOf('\n', matchIndex) + 1;
  const prevLineStart = source.lastIndexOf('\n', Math.max(0, lineStart - 2)) + 1;
  const linesAbove = source.substring(prevLineStart, matchIndex).toLowerCase();
  if (linesAbove.includes('enforce-ignore')) {
    // Check if specific pattern name is mentioned, or generic ignore
    if (linesAbove.includes('enforce-ignore-all') ||
        (patternName && linesAbove.includes(patternName.toLowerCase()))) {
      return true;
    }
    // Generic enforce-ignore on same/prev line
    if (linesAbove.includes('enforce-ignore')) {
      return true;
    }
  }

  // Original keyword check
  if (!keywords || keywords.length === 0) return false;
  return keywords.some(kw => region.includes(kw.toLowerCase()));
}

// ═══════════════════════════════════════════════════════════════════════════
// SELF-EXEMPTION
// ═══════════════════════════════════════════════════════════════════════════

const EXEMPT_PATHS = [
  '.claude/hooks', '.claude\\hooks',
  'enforce-mode/hooks', 'enforce-mode\\hooks',
  '/tests/', '\\tests\\', '/test/', '\\test\\',
  'test-', '.test.', '.spec.', '__tests__',
  '/fixtures/', '\\fixtures\\',
];

function isExemptPath(fp) {
  return fp && EXEMPT_PATHS.some(p => fp.includes(p));
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVE DOMAINS CACHE
// ═══════════════════════════════════════════════════════════════════════════

let _activeDomains = null;

function getActiveDomains() {
  if (_activeDomains !== null) return _activeDomains;
  try {
    const { detectDomains } = require('./enforce-detect');
    const detected = detectDomains(process.cwd());
    _activeDomains = new Set(detected.map(d => d.domain));
  } catch {
    _activeDomains = new Set();
  }
  return _activeDomains;
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE
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

/**
 * Detect which domain categories apply to this file.
 */
function getRelevantDomains(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  const activeDomains = getActiveDomains();
  const relevant = [];

  for (const domain of Object.keys(DOMAIN_PATTERNS)) {
    if (activeDomains.has(domain)) {
      relevant.push(domain);
    }
  }

  const extDomain = EXT_TO_DOMAIN[ext];
  if (extDomain && !relevant.includes(extDomain)) {
    relevant.push(extDomain);
  }

  return relevant;
}

/**
 * v3: Scan source for domain pattern violations.
 * Includes per-pattern-per-file dedup (Change 1) and cross-domain overlap (Change 2).
 */
function scanDomainPatterns(source, filePath) {
  const relevant = getRelevantDomains(filePath);
  const violations = [];
  const seenPatterns = new Set(); // Change 1: dedup by pattern name per file

  for (const domain of relevant) {
    const patterns = DOMAIN_PATTERNS[domain] || [];

    for (const pat of patterns) {
      // Change 2: Skip if same pattern name already found from another domain
      if (seenPatterns.has(pat.name)) continue;

      const regex = pat._compiledRegex || pat.regex; // Change 4: use pre-compiled

      const match = regex.exec(source);
      if (!match) continue;

      const matchIndex = match.index;

      // Check justification + inline suppression (Change 3)
      if (hasJustification(source, matchIndex, pat.justification, pat.name)) {
        continue;
      }

      // Change 1: Mark pattern as seen (one violation per pattern per file)
      seenPatterns.add(pat.name);

      violations.push({
        domain,
        pattern: pat,
        matchIndex,
        confidence: pat.confidence,
        severity: pat.severity || 'STRICT', // v3: default STRICT if missing
      });
    }
  }

  return violations;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const input = await readStdin();
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  if (!['Write', 'Edit', 'NotebookEdit'].includes(toolName)) process.exit(0);

  const sessionId = input.session_id || '';
  if (sessionId && !isActive(sessionId)) process.exit(0);

  const filePath = toolInput.file_path || toolInput.notebook_path || '';
  const source = toolInput.content || toolInput.new_source || toolInput.new_string || '';

  if (!source || !filePath) process.exit(0);
  if (isExemptPath(filePath)) process.exit(0);

  // Change 5: Early exit on very small source (imports, config lines)
  if (source.length < 50) process.exit(0);

  // Tick PECK recovery windows
  peckTick(sessionId);

  // Scan for domain-specific violations
  const violations = scanDomainPatterns(source, filePath);
  if (violations.length === 0) process.exit(0);

  // Process most severe violation (highest confidence first, then severity)
  violations.sort((a, b) => {
    const confOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const sevOrder = { CRITICAL: 3, STRICT: 2, WARN: 1 };
    const confDiff = (confOrder[b.confidence] || 0) - (confOrder[a.confidence] || 0);
    if (confDiff !== 0) return confDiff;
    return (sevOrder[b.severity] || 0) - (sevOrder[a.severity] || 0);
  });

  const top = violations[0];
  const activeDomains = getActiveDomains();
  const domainActive = activeDomains.has(top.domain);

  // v3: Get current enforcement level
  const level = (sessionId && getLevel(sessionId)) || 'solo';

  const reason =
    '[' + top.domain.toUpperCase() + '] ' + top.pattern.name + '\n' +
    'Risk: ' + top.pattern.risk + '\n' +
    'File: ' + filePath +
    (violations.length > 1 ? '\n(+' + (violations.length - 1) + ' more violations in this file)' : '');

  // v3: Pass severity and level to peckEvaluateV2
  const result = peckEvaluateV2(sessionId, top.domain, filePath, reason, {
    confidence: top.confidence,
    source,
    matchIndex: top.matchIndex,
    domainActive,
    patternName: top.pattern.name,
    severity: top.severity,
    level,
  });

  // Suppressed or advisory with empty message → exit cleanly
  if (result.suppressed || !result.message) {
    process.exit(0);
  }

  // Emit tier-appropriate response
  if (result.tier >= 3) {
    process.stderr.write(result.message);
    process.exit(2);
  }
  if (result.tier === 2) {
    const out = { hookSpecificOutput: { hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: result.message }};
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }
  // Tier 0 or 1: approve + context
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse',
    additionalContext: result.message }};
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

main().catch(() => process.exit(0));
