#!/usr/bin/env node
/**
 * enforce-domain-guard.js — PECK v2 domain-specific pattern guard
 *
 * Unified PreToolUse hook for Write|Edit|NotebookEdit that covers:
 *   - Blockchain (reentrancy, gas, access control)
 *   - Frontend (XSS, a11y, key props, effect deps)
 *   - Mobile (memory leaks, main thread, permissions)
 *   - Research paper (citations, reproducibility, statistics)
 *   - Model training (LR, data splits, checkpointing)
 *   - Book generation (TOC, cross-refs, heading hierarchy)
 *
 * Uses PECK v2 confidence-weighted evaluation:
 *   - Each pattern has confidence: HIGH|MEDIUM|LOW
 *   - Context detection (comments, tests, types) suppresses FPs
 *   - Domain relevance check prevents cross-domain false triggers
 *   - Justification keywords clear violations
 *
 * DESIGN PRINCIPLES (FP/FN reduction):
 *   - HIGH confidence: structural patterns with prefix/suffix anchors
 *   - MEDIUM confidence: syntactic features with legitimate edge cases
 *   - LOW confidence: absence detection (missing X), high context dependence
 *   - Every pattern has justificationKeywords that suppress when found nearby
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { isActive, peckEvaluateV2, peckTick, peckRecordComplianceV2 } = require('./enforce-state');

// ═══════════════════════════════════════════════════════════════════════════
// DOMAIN PATTERNS — each with confidence and justification keywords
// ═══════════════════════════════════════════════════════════════════════════

const DOMAIN_PATTERNS = {
  // ─── BLOCKCHAIN ───
  blockchain: [
    {
      name: 'Reentrancy: external call before state update',
      regex: /\.call\{[^}]*\}\s*\([^)]*\)[\s\S]{0,200}(?:balances|balance|amounts?|state)\s*[\[.=]/,
      risk: 'Reentrancy vulnerability — state change after external call. Use CEI pattern.',
      confidence: 'HIGH',
      multiline: true,
      justification: ['CEI', 'nonReentrant', 'ReentrancyGuard', 'checks-effects-interactions'],
    },
    {
      name: 'Unchecked external call',
      regex: /\(bool\s+\w*,?\s*\)\s*=\s*\w+\.call\{[^}]*\}\([^)]*\);(?!\s*require|\s*if\s*\()/,
      risk: 'External call return value not checked — silent failure.',
      confidence: 'HIGH',
      multiline: false,
      justification: ['require(success', 'if (!success', 'if (success)', 'SafeTransferLib'],
    },
    {
      name: 'Unbounded loop over dynamic array',
      regex: /for\s*\(\s*uint\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*\w+\.length\s*;/,
      risk: 'Gas-unbounded loop — DoS if array grows. Cap with MAX_LENGTH.',
      confidence: 'MEDIUM',
      multiline: false,
      justification: ['MAX_LENGTH', 'MAX_USERS', 'bounded', 'gas:', 'maxIterations'],
    },
    {
      name: 'tx.origin for authentication',
      regex: /require\s*\(\s*tx\.origin\s*==|if\s*\(\s*tx\.origin\s*[!=]/,
      risk: 'tx.origin vulnerable to phishing attacks. Use msg.sender.',
      confidence: 'HIGH',
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
      confidence: 'MEDIUM',
      multiline: false,
      justification: ['DOMPurify', 'sanitize', 'xss', 'purify', 'trusted HTML'],
    },
    {
      name: 'List render without key prop',
      regex: /\.map\s*\([^)]*\)\s*(?:=>|{)\s*(?:<|\(?\s*<)[A-Z]\w*/,
      risk: 'Missing key prop — React reconciliation bugs, state leaks.',
      confidence: 'LOW',
      multiline: true,
      justification: ['key={', 'key=', 'keyExtractor'],
    },
    {
      name: 'useEffect with empty deps but using external values',
      regex: /useEffect\s*\(\s*\(\)\s*=>\s*\{[^}]{20,}\}\s*,\s*\[\s*\]\s*\)/,
      risk: 'Empty dependency array with captured variables — stale closure risk.',
      confidence: 'LOW',
      multiline: true,
      justification: ['eslint-disable', 'exhaustive-deps', 'intentionally empty', 'mount only'],
    },
    {
      name: 'Image without alt attribute',
      regex: /<img\s+(?:(?!alt=)[^>])*\/?>/,
      risk: 'Accessibility violation — images need alt text for screen readers.',
      confidence: 'MEDIUM',
      multiline: false,
      justification: ['alt=', 'aria-label', 'role="presentation"', 'decorative'],
    },
    {
      name: 'localStorage for auth tokens',
      regex: /localStorage\.setItem\s*\(\s*['"](?:token|auth|jwt|session|access_token)/i,
      risk: 'Auth tokens in localStorage vulnerable to XSS. Use httpOnly cookies.',
      confidence: 'HIGH',
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
      confidence: 'MEDIUM',
      multiline: true,
      justification: ['removeEventListener', 'cleanup', 'dispose', 'unsubscribe', 'return ()'],
    },
    {
      name: 'Synchronous file/DB operation on main thread',
      regex: /(?:readFileSync|writeFileSync|execSync|SQLite\.execute)\s*\(/,
      risk: 'Blocking main thread — causes UI jank and ANR.',
      confidence: 'MEDIUM',
      multiline: false,
      justification: ['Worker', 'async', 'dispatch_async', 'background', 'Isolate'],
    },
    {
      name: 'Location/camera access without permission check',
      regex: /(?:getCurrentPosition|requestLocation|getPhoto|launchCamera)\s*\(/,
      risk: 'Accessing hardware without permission check — crash on denial.',
      confidence: 'LOW',
      multiline: false,
      justification: ['checkPermission', 'requestPermission', 'hasPermission', 'authorization'],
    },
    {
      name: 'setInterval without cleanup reference',
      regex: /setInterval\s*\([^)]+\)(?!\s*(?:const|let|var)\s+\w+\s*=|\s*;\s*return)/,
      risk: 'Interval without cleanup reference — memory leak, battery drain.',
      confidence: 'LOW',
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
      confidence: 'MEDIUM',
      multiline: false,
      justification: ['\\cite{', '[1]', '(2024)', '(2023)', 'et al.', 'Table \\ref'],
    },
    {
      name: 'Results without error bars or std',
      regex: /(?:accuracy|F1|precision|recall|BLEU|ROUGE)\s*[:=]\s*\d+\.?\d*(?!\s*[±\\]|\s*\(|\s*\+)/,
      risk: 'Single-point metric without variance — unreproducible.',
      confidence: 'LOW',
      multiline: false,
      justification: ['±', '\\pm', 'std', 'CI', 'p<', 'p =', 'n=', 'averaged over'],
    },
    {
      name: 'Experiment without random seed',
      regex: /(?:experiment|training|evaluation)\s*(?:config|setup|protocol)[\s\S]{0,200}(?!seed|random_state|manual_seed)/i,
      risk: 'No random seed documented — results not reproducible.',
      confidence: 'LOW',
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
      confidence: 'MEDIUM',
      multiline: true,
      justification: ['scheduler', 'warmup', 'lr_find', 'OneCycleLR', 'CosineAnnealing', 'validated'],
    },
    {
      name: 'Training without validation split',
      regex: /\.fit\s*\([^)]*\)(?![\s\S]{0,150}(?:validation|val_split|eval|test_size))/,
      risk: 'Training without validation — overfitting undetected.',
      confidence: 'MEDIUM',
      multiline: true,
      justification: ['validation_split', 'val_loader', 'eval_dataset', 'test_size', 'cross_val'],
    },
    {
      name: 'No checkpoint saving in training loop',
      regex: /(?:for\s+epoch|num_epochs|training_loop)[\s\S]{0,500}(?!(?:save_checkpoint|model\.save|torch\.save|save_pretrained))/,
      risk: 'Training without checkpointing — progress lost on interruption.',
      confidence: 'LOW',
      multiline: true,
      justification: ['save_checkpoint', 'torch.save', 'save_pretrained', 'ModelCheckpoint', 'every'],
    },
    {
      name: 'No gradient clipping',
      regex: /(?:loss\.backward|backward)\s*\(\)[\s\S]{0,100}(?:optimizer\.step|step\(\))(?![\s\S]{0,100}clip_grad)/,
      risk: 'No gradient clipping — risk of exploding gradients.',
      confidence: 'LOW',
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
      confidence: 'LOW',
      multiline: false,
      justification: ['verified', 'exists', 'TOC line', 'see above', 'previous section'],
    },
    {
      name: 'Heading level skip',
      regex: /^#{1,2}\s+.+\n(?:(?!^#{1,4}\s)[\s\S])*?^#{4,6}\s+/m,
      risk: 'Heading hierarchy skips levels (H2 → H4) — breaks document structure.',
      confidence: 'MEDIUM',
      multiline: true,
      justification: ['hierarchy:', 'intentional', 'sidebar', 'aside', 'callout'],
    },
    {
      name: 'TODO/FIXME in content',
      regex: /(?:TODO|FIXME|PLACEHOLDER|TBD|DRAFT|XXX)(?:\s*:|\s+\w)/,
      risk: 'Incomplete content marker — not ready for publication.',
      confidence: 'HIGH',
      multiline: false,
      justification: ['WIP', 'internal draft', 'dev notes', 'not published'],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// FILE EXTENSION → DOMAIN MAPPING
// ═══════════════════════════════════════════════════════════════════════════

const EXT_TO_DOMAIN = {
  '.sol': 'blockchain', '.vy': 'blockchain',
  '.tsx': 'frontend', '.jsx': 'frontend', '.vue': 'frontend', '.svelte': 'frontend',
  '.swift': 'mobile', '.kt': 'mobile', '.dart': 'mobile',
  '.tex': 'research-paper', '.bib': 'research-paper',
  '.ipynb': 'training',
  '.md': 'book', '.rst': 'book', '.adoc': 'book',
};

// ═══════════════════════════════════════════════════════════════════════════
// JUSTIFICATION CHECK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if justification keywords are present near the match.
 * Searches within 200 chars before/after the match location in source.
 */
function hasJustification(source, matchIndex, keywords) {
  if (!keywords || keywords.length === 0) return false;
  const start = Math.max(0, matchIndex - 200);
  const end = Math.min(source.length, matchIndex + 200);
  const region = source.substring(start, end).toLowerCase();
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
 * Returns array of domain names to check patterns for.
 */
function getRelevantDomains(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  const activeDomains = getActiveDomains();
  const relevant = [];

  // Check all domains that are active for this project
  for (const domain of Object.keys(DOMAIN_PATTERNS)) {
    if (activeDomains.has(domain)) {
      relevant.push(domain);
    }
  }

  // Also check domain by file extension (even if not detected at project level)
  const extDomain = EXT_TO_DOMAIN[ext];
  if (extDomain && !relevant.includes(extDomain)) {
    relevant.push(extDomain);
  }

  return relevant;
}

/**
 * Scan source for domain pattern violations.
 * Returns array of { domain, pattern, matchIndex, confidence }.
 */
function scanDomainPatterns(source, filePath) {
  const relevant = getRelevantDomains(filePath);
  const violations = [];

  for (const domain of relevant) {
    const patterns = DOMAIN_PATTERNS[domain] || [];

    for (const pat of patterns) {
      let regex = pat.regex;
      if (pat.multiline) {
        regex = new RegExp(regex.source, regex.flags + (regex.flags.includes('s') ? '' : 's'));
      }

      const match = regex.exec(source);
      if (!match) continue;

      const matchIndex = match.index;

      // Check justification keywords near match
      if (hasJustification(source, matchIndex, pat.justification)) {
        continue; // Justified — skip this pattern
      }

      violations.push({
        domain,
        pattern: pat,
        matchIndex,
        confidence: pat.confidence,
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

  // Tick PECK recovery windows
  peckTick(sessionId);

  // Scan for domain-specific violations
  const violations = scanDomainPatterns(source, filePath);
  if (violations.length === 0) process.exit(0);

  // Process most severe violation (highest confidence first)
  violations.sort((a, b) => {
    const confOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return (confOrder[b.confidence] || 0) - (confOrder[a.confidence] || 0);
  });

  const top = violations[0];
  const activeDomains = getActiveDomains();
  const domainActive = activeDomains.has(top.domain);

  const reason =
    '[' + top.domain.toUpperCase() + '] ' + top.pattern.name + '\n' +
    'Risk: ' + top.pattern.risk + '\n' +
    'File: ' + filePath +
    (violations.length > 1 ? '\n(+' + (violations.length - 1) + ' more violations in this file)' : '');

  const result = peckEvaluateV2(sessionId, top.domain, filePath, reason, {
    confidence: top.confidence,
    source,
    matchIndex: top.matchIndex,
    domainActive,
    patternName: top.pattern.name,
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
