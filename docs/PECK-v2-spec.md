# PECK v2: Confidence-Weighted Progressive Escalation

## Algorithm Overview

PECK v2 extends the original PECK (Progressive Escalation with Circuit-breaker and K-step recovery) with three new mechanisms that reduce false positives and false negatives:

1. **Confidence-weighted violations** — patterns declare their precision level
2. **Contextual suppression** — benign contexts cancel detections
3. **Domain-aware compliance paths** — each domain defines what "fixing it" means

## Core Formula

```
effectiveWeight = patternConfidence × contextMultiplier × domainRelevance

if effectiveWeight < ACCUMULATION_THRESHOLD (0.5):
    → advisory only (tier 0 max, never escalates)
elif effectiveWeight < 0.75:
    → standard escalation (tier 0 → 1 → 2 → 3 per budget)
else:
    → accelerated escalation (skip tier 0, start at tier 1)
```

## Pattern Confidence Levels

Each detection pattern declares a confidence level:

| Level | Value | Meaning | Example |
|-------|-------|---------|---------|
| HIGH | 1.0 | Near-certain violation, low FP risk | Hardcoded AWS key (AKIA prefix) |
| MEDIUM | 0.5 | Likely violation, some FP possible | `eval()` usage (could be intentional) |
| LOW | 0.25 | Possible violation, high FP risk | Express route without visible auth decorator |

### Assignment Criteria

- **HIGH**: Pattern has structural prefix/suffix that eliminates ambiguity (e.g., `ghp_` + 36 chars = GitHub PAT)
- **MEDIUM**: Pattern matches syntactic feature that is usually wrong but has legitimate uses
- **LOW**: Pattern detects absence of something (missing auth, missing key prop) — high context-dependence

## Context Multipliers

Before escalation, check WHERE the match occurred:

| Context | Multiplier | Rationale |
|---------|-----------|-----------|
| Inside code comment | 0.0 | Comments are documentation, not execution |
| Inside string literal (non-assignment) | 0.1 | Usually log messages or docs |
| Inside test file | 0.0 | Tests intentionally test bad patterns |
| Inside type definition / interface | 0.0 | Type annotations, not runtime code |
| Inside try/catch with specific handler | 0.5 | Developer aware of the risk |
| Normal code context | 1.0 | Full weight |
| Inside security-sensitive file (auth.js, middleware.js) | 1.5 | Extra scrutiny |

### Context Detection Rules

```
isComment(line):
    starts with //, #, /*, *, or is inside /* */ block

isStringLiteral(match, line):
    match is inside quotes AND not part of assignment (=, :)
    
isTestFile(filePath):
    path contains /test/, .test., .spec., __tests__, /fixtures/

isTypeOnly(line):
    matches: interface, type, @typing, -> None, : str, : int (declarations only)
```

## Domain Relevance Scoring

When a guard fires, check if the detected domain is ACTIVE for the current project:

```
domainRelevance = 1.0  (if domain detected by enforce-detect.js)
domainRelevance = 0.3  (if domain NOT detected but file extension matches)
domainRelevance = 0.0  (if neither — suppress entirely)
```

This prevents blockchain rules from firing in a React project that happens to use `.call()`.

## Category Budgets v2

Budgets now scale with pattern confidence distribution:

| Category | Budget | Rationale |
|----------|--------|-----------|
| security-secrets | 1 | HIGH confidence patterns only → budget=1 safe |
| security-patterns | 3 | MEDIUM confidence → needs room for FPs |
| research | 4 | LOW-MEDIUM confidence → generous budget |
| dsa | 3 | MEDIUM confidence → unchanged |
| test | 2 | Transcript-based → unchanged |
| blockchain | 3 | MEDIUM-HIGH for Solidity patterns |
| frontend | 4 | MEDIUM patterns, many legitimate exceptions |
| mobile | 3 | MEDIUM patterns |
| research-paper | 5 | LOW confidence, high FP risk → very generous |
| training | 3 | MEDIUM confidence |
| book | 5 | LOW confidence → advisory-heavy |

**Key change**: Split `security` into `security-secrets` (HIGH confidence, budget=1) and `security-patterns` (MEDIUM confidence, budget=3). This prevents a regex overmatch on `eval()` from permanently blocking the session.

## Compliance Paths (Domain-Specific)

Each domain defines HOW to clear a violation:

### Universal Compliance (all domains)
- WebSearch/WebFetch with domain-relevant terms in transcript
- In-code justification comment matching domain keywords

### Domain-Specific Compliance

| Domain | Compliance Action | Verification |
|--------|-------------------|--------------|
| security-secrets | Remove the secret, use env var | Re-scan content clean |
| security-patterns | Add auth decorator / sanitization | Pattern no longer matches |
| dsa | Complexity comment OR research DSA terms | Comment regex OR transcript |
| research | WebSearch for library docs | Transcript contains tool + relevant terms |
| blockchain | Add CEI comment, use SafeLib, bounded comment | Keyword in code |
| frontend | Add DOMPurify, key prop, deps array, alt text | Pattern no longer matches |
| mobile | Add cleanup, move to worker, check permissions | Pattern no longer matches OR keyword |
| research-paper | Add \cite{}, seed, ± notation | Pattern match in code |
| training | Add validation split, LR schedule, checkpoint | Keyword in code |
| book | Add TOC entry, cross-ref verification comment | Keyword in code |
| test | Run test command (pass/fail now checked) | Transcript shows test + exit 0 |

## Enhanced Exact Retry Detection

PECK v1 uses 30s window for exact retry. PECK v2 adds:

```
isSemanticRetry(current, previous):
    same category + same file + same pattern name (not just fingerprint)
    → 1.5x multiplier (not 2x — less punitive for different approach)

isExactRetry(current, previous):
    same category + same file + identical content hash
    → 2x multiplier (unchanged)
```

## Circuit Breaker v2

PECK v1 opens circuit after 3 failures. PECK v2:

```
circuitFailureThreshold:
    HIGH confidence patterns: 2 failures → open
    MEDIUM confidence patterns: 4 failures → open  
    LOW confidence patterns: never opens (advisory only)
```

LOW confidence patterns CANNOT open the circuit breaker. They can accumulate advisories but never hard-block.

## K-Step Recovery v2

Recovery window scales with violation weight:

```
recoverySteps = baseSteps × (1 / effectiveWeight)

effectiveWeight = 1.0 → 5 steps (unchanged)
effectiveWeight = 0.5 → 10 steps (more time for MEDIUM confidence)
effectiveWeight = 0.25 → advisory only (no recovery window)
```

## Forgiveness Decay v2

Compliance decay now considers pattern confidence:

```
on compliance:
    violation.count -= forgivenessDecay × patternConfidence
    (HIGH confidence compliance = stronger forgiveness)
```

## Test Pass/Fail Verification (FN Reduction)

PECK v1 only checks if test command appears in transcript. PECK v2:

```
testCompliance:
    1. Test command found in transcript? (existing check)
    2. Exit code = 0? (new: parse "exit code" or "X passed" from output)
    3. If test found but exit != 0 → half-compliance (violation decays by 0.5 instead of 1)
```

## Research Relevance Check (FN Reduction)

PECK v1 checks if WebSearch tool was used. PECK v2:

```
researchCompliance:
    1. Research tool used? (existing check)
    2. Search terms overlap with imported library names? (new)
       - Extract library names from imports in the file
       - Check if transcript contains those library names near research tool calls
    3. If tool used but terms don't overlap → half-compliance
```

## Data Flow

```
PreToolUse hook fires
    → Extract source code + file path
    → Detect patterns (with confidence level)
    → For each match:
        → Compute contextMultiplier (comment? test? string?)
        → Compute domainRelevance (domain active?)
        → effectiveWeight = confidence × context × domain
        → if effectiveWeight < 0.5: emit advisory, skip escalation
        → else: peckEvaluate(session, category, file, reason, effectiveWeight)
    → PECK engine:
        → Check circuit breaker (v2: confidence-aware threshold)
        → Compute violation increment (effectiveWeight, not always +1)
        → Compute tier from weighted violations vs budget
        → Start recovery window (scaled by weight)
        → Emit tier-appropriate response
```

## Backward Compatibility

- All existing categories (research, dsa, test, security) continue to work
- Existing patterns default to MEDIUM confidence if not annotated
- Existing budgets unchanged for existing categories
- New categories only fire when new domains detected
- Circuit breaker behavior unchanged for HIGH confidence patterns

## Migration Path

1. Add `confidence` field to all pattern objects (default: 'MEDIUM')
2. Add `contextCheck` function to guard hooks (before peckEvaluate)
3. Split security category into secrets vs patterns
4. Add effectiveWeight parameter to peckEvaluate()
5. Update budgets in PECK_CONFIG
6. Add new domain patterns incrementally

## Metrics (Expected FP/FN Impact)

| Change | FP Reduction | FN Reduction |
|--------|-------------|-------------|
| Confidence scoring | ~40% (LOW patterns can't escalate) | — |
| Context suppression | ~25% (comments/tests/types exempt) | — |
| Domain relevance | ~15% (cross-domain false triggers eliminated) | — |
| Split security category | ~10% (eval/route patterns get more budget) | — |
| Research relevance check | — | ~30% (catches fake compliance) |
| Test pass/fail check | — | ~25% (catches failed tests) |
| New domain patterns | — | ~45% (covers previously undetected issues) |

**Combined estimate**: ~60-70% FP reduction, ~65-75% FN reduction vs PECK v1.
