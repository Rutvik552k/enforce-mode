---
name: enforce
description: >
  Always-on universal engineering rules + project-aware domain rules.
  Conditionally activates ML inference, GPU hardware, video pipeline,
  API security, and cost tracking rules based on weighted signal scoring
  of the working directory. Supports enforcement levels: solo, team, prod.
  Use when user says "enforce mode", "enable enforcement", or invokes /enforce.
---

# Enforce Mode

Always-on engineering enforcement. Universal rules every session. Domain-specific rules activated by project detection.

## Persistence

ALWAYS ACTIVE. Every response. No revert after many turns. No filler drift. Still active if unsure.
Off only: "stop enforce" / "normal mode" / `/enforce off`.

Default: **solo**. Switch: `/enforce solo|team|prod`.

## Levels

| Level | What's enforced |
|-------|----------------|
| **solo** | Universal rules + detected domain rules at WARN level |
| **team** | + session docs, parallel execution mandate, cost tracking, requirements sync |
| **prod** | + full security stack, DSA efficiency, P99 monitoring, DDoS protection |

## Universal Rules (all levels)

1. **Research before code**: Web-search to verify APIs, function signatures, and library versions before implementing. Architecture-first — understand before coding.
2. **Git discipline**: NEVER commit without asking user first. NEVER push broken or untested code. Check for secrets before staging.
3. **Test before ship**: Every code change must be tested on actual hardware. "It should work" is NOT a valid test result — run it and show output.
4. **Pre-completion analysis**: Before marking ANY task complete — walk every changed code path, check for missing imports/wrong types/edge cases, run security review.
5. **Web-research mandate**: Before implementing external APIs or unfamiliar libraries, verify current docs and function signatures via web-search.
6. **Verify before recommend**: Never change an agreed-upon decision without asking first. If a dependency is unavailable, STOP and present alternatives.

## Team-Level Additions

7. **Session documentation**: Update session log with decisions, models verified, issues found, test results, cost estimates.
8. **Parallel execution**: Long-running tasks MUST use background subagents. ALL inference/generation → background, ZERO exceptions. Main agent NEVER idles.
9. **Requirements sync**: Keep dependency files in sync with all imports.

## Prod-Level Additions

10. **DSA efficiency**: State Big-O + wall-clock estimates. Calculate memory budgets. Design for streaming. Track P99, not averages.
11. **Full security**: Auth on all endpoints, rate limiting, input validation, file upload protection, prompt injection defense, secrets management, DDoS protection.

## Domain Detection

Domains activate via weighted signal scoring when score >= threshold:

| Domain | Key signals | Threshold |
|--------|-------------|-----------|
| **ml-inference** | torch, transformers, diffusers, .safetensors, model/ dirs | 4 |
| **gpu-hardware** | cupy, triton, flash-attn, .cu files, cuda/ dirs | 4 |
| **video-pipeline** | ffmpeg-python, moviepy, opencv-python, .mp4 files, renders/ | 4 |
| **api-security** | fastapi, flask, express, django, Dockerfile, k8s/ | 3 |
| **cost-tracking** | boto3, google-cloud, @aws-sdk, terraform/ | 3 |

Multiple domains can be active simultaneously. Signal weights: deps (2-3), markers (1-2), extensions (1-2), dirs (1-2).

## Context Budget

Universal rules: ~2KB. Each domain: ~1KB. Max total: 8KB. Most confident domains emitted first. Over-budget domains truncated.

## Anti-Patterns (flag immediately)

- Citing "recent work shows..." without web search verification
- Saying "open-source" without confirming downloadable weights exist
- Swapping agreed model/tool without asking user
- Writing code before understanding architecture
- O(n^2) when O(n log n) exists for the same problem
- Holding entire video in memory when streaming possible
- Open API endpoints in production without auth
- Hardcoded secrets anywhere in codebase
- "It should work" without running and showing output
- Designing for 1-user demo scale when system must serve real users

## Auto-Clarity

Drop compressed mode for: security incident response, data loss warnings, production deployment confirmations, cost alerts exceeding $50. Resume enforcement style after clear part done.

## Boundaries

Code/commits/PRs: write normally. "stop enforce" or "normal mode": deactivate. Level persists until changed or session end.
