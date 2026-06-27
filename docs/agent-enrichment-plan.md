# Agent Roster Enrichment Plan

Goal: make every enforce-mode subagent embody **real-world industry responsibilities**,
inherit **cross-cutting mechanisms** when its solution needs them, and apply named
**DSA/algorithms** with stated Big-O — plus fail-loud code discipline and a clean,
de-duplicated rule base.

Ground truth: 6 parallel cluster audits read all 28 agent `.md` files and compared each
against its real-world role. Algorithms cited are established industry practice (tool/paper
named where relevant). Anything unverified is tagged UNVERIFIED (none required web lookup).

---

## 1. The three-layer model

A responsibility belongs to exactly one layer. Keeping them separate is the whole point —
your `frontend → bot-detection` example was a layer error (that is project/scraping logic,
not frontend work).

1. **Universal layer** — every agent inherits via `universal.md` (already loaded into every
   subagent, verified). Holds: ground-truth-before-code, NFRs (CRUD, reliability,
   maintainability, scalability, alterability, loggability, security, complexity target),
   critique gate, git/test discipline.
2. **Inherited-mechanisms layer** — cross-cutting capabilities pulled in *only when the
   solution needs them*. This is your "rate-limiting is inherited when building a public API"
   model. Lives in ONE shared file: `rules/mechanisms.md` (the matrix in §2). Agents
   reference it; no duplication.
3. **Domain layer** — what THAT engineer actually builds + the DSA native to the domain.
   Lives in each agent `.md` (§3).

---

## 2. Shared inherited-mechanisms matrix  →  new file `rules/mechanisms.md`

Each mechanism: the trigger that makes an agent inherit it, the algorithm/data structure
that implements it, its Big-O, and which agents inherit it.

| Mechanism | Inherited WHEN (trigger) | Algorithm / data structure | Big-O | Inheriting agents |
|---|---|---|---|---|
| Rate limiting / quota | public or multi-tenant endpoint; auth brute-force surface | **Token bucket** (smooths bursts), leaky bucket; sliding-window counter | O(1) | backend, cloud, sre, security, ai-application |
| AuthN/AuthZ | any user-facing or service entry point | JWT + refresh rotation, OAuth2/OIDC, RBAC/ABAC; object-level (BOLA) check | O(1) verify | backend, fullstack, security, mobile |
| Idempotency / replay-safety | retried mutation, webhook, on-chain tx | hash/UUID idempotency key + stored result; nonce | O(1) dedup | backend, data, fullstack, security, blockchain |
| Caching | hot read path, expensive recompute | **LRU** (O(1) get/evict), LFU, read-through/write-back; semantic cache (LLM) | O(1) | backend, frontend, database, ai-application, mobile |
| Retry + backoff | transient outbound failure | exponential backoff **+ jitter** (kills thundering herd) | O(1)/attempt | backend, sre, devops, mobile, ai-application |
| Circuit breaker | call to untrusted/slow dependency | ring-buffer failure-rate + half-open probe | O(1) | backend, sre, cloud, ai-application |
| Bulkhead / backpressure | shared resource under load | bounded queue, isolated pools, AIMD admission control | O(1) | backend, sre |
| Connection pooling | DB / network resource reuse | bounded pool + validation, PgBouncer-style | O(1) checkout | backend, database |
| Pagination | list endpoint over growing data | **keyset/cursor** (seek), not OFFSET | O(log n) seek | backend, fullstack, database |
| Debounce / throttle | high-frequency UI/network events | leading/trailing time gate | O(1) | frontend, mobile |
| Virtualization / windowing | long list render | render only visible window | O(visible) | frontend, mobile, design-system |
| Optimistic update + rollback | mutating UI action | apply-then-reconcile, compensating revert | O(1) | frontend, fullstack, mobile |
| Offline queue + replay | intermittent connectivity (mobile) | durable queue + idempotent replay + backoff | O(1) enqueue | mobile |
| Input validation | any untrusted input | schema guard (Zod/Pydantic), allow-list | O(n) | all builders, security |
| Autoscaling | variable load | target-tracking / step; HPA/Karpenter; bin-packing place | NP-hard→greedy | cloud, sre, devops |
| Progressive delivery | production deploy | blue-green, canary + auto-analysis, feature-flag/kill-switch | — | devops, sre, release, cloud |
| Checkpointing | long training / preemptible compute | periodic state snapshot + resume | O(state) | ml, computer-vision |
| Quantization / pruning | model serving cost/latency | int8/int4 (GPTQ/AWQ), structured prune | — | ml, computer-vision |
| Vector retrieval | semantic search / RAG | **HNSW** ANN, IVF-PQ at scale | ~O(log n) | ai-application, ml, research |
| Dependency DAG + critical path | multi-step plan/pipeline | **topological sort** (Kahn) + CPM longest-path | O(V+E) | team-orchestrator, project-manager, release, devops |
| Reentrancy guard / access control | external call from contract | CEI + nonReentrant lock; OZ AccessControl | O(1) | blockchain |

---

## 3. Per-agent enrichment (all 28)

Format per agent — **Add** = real-world responsibilities to add to its method/playbook;
**DSA** = named algorithms to record with Big-O + why. (Current state omitted here for
brevity; full current-state is in the cluster audits — each agent already has a solid base.)

### Builder engineers

**backend-engineer** — Add: JWT/refresh rotation, OAuth2/OIDC, RBAC/ABAC + object-level (BOLA) authz, per-consumer rate-limit/quota tiers, mTLS/SPIFFE, request signing (HMAC), API versioning/deprecation, cursor pagination, event schema-evolution (Avro compat).
DSA: Token Bucket O(1) (NGINX/Stripe); Consistent hashing O(log n) (DynamoDB/Cassandra); HyperLogLog O(1) (quota unique-counts); Bloom filter O(k) (idempotency dedup); Snowflake/ULID O(1) (sortable IDs).

**database-engineer** — Add: row-level security + column encryption/masking for PII, deadlock detection/retry + lock-timeout, HA/failover (Patroni, fencing, RPO/RTO), per-tenant connection limits + statement_timeout, CDC ops (Debezium/logical slots), PITR detail.
DSA: B+tree O(log n); LSM+SSTable (O(1) amortized write); skip list O(log n); hash index O(1); GiST/GIN O(log n) (FTS/geo); MVCC version chains O(1) snapshot reads.

**data-engineer** — Add: FinOps (slot/credit mgmt, partition-pruning cost), backfill SLAs + DAG sensors/retries, PII governance (tokenization, GDPR erasure across lake, retention), streaming exactly-once (Kafka txns, dedup window/state-store), data-mesh contract enforcement.
DSA: HyperLogLog O(1); Bloom filter O(k) (join pruning); external merge sort O(n log n) (Spark shuffle); Roaring bitmaps (set ops); watermark heap-merge O(log n) (Flink); t-digest O(1) (streaming quantiles).

**ai-application-engineer** — Add: chunking + embedding-model versioning/reindex, semantic + prompt caching, per-tenant vector namespace isolation (cross-tenant leak), conversation memory + context compaction, fallback model routing, structured tool-call retry, eval CI gating + jailbreak red-teaming.
DSA: HNSW O(log n) (Qdrant/pgvector); IVF-PQ (billion-scale); BM25 inverted (sparse half); Reciprocal Rank Fusion O(n log n) (hybrid); cosine/MIPS O(d); cross-encoder rerank O(k·L).

**frontend-engineer** — Add: useTransition/useDeferredValue priority, form UX at scale (dirty-tracking, async field validation, autosave, unsaved-guard), real-time transport choice (WS/SSE/poll) + reconnect, bundle observability + CI route budgets.
DSA: Virtual DOM keyed diff O(n) (vs O(n³) naive); windowing O(visible) (react-window); debounce/throttle O(1); trie O(k) (autocomplete); LRU O(1) (TanStack query cache).

**fullstack-engineer** — Add (thinnest agent, needs most): auth/session across the seam (cookie/JWT/refresh/CSRF), N+1 batching/DataLoader at API→DB, BFF/aggregation, idempotency keys, webhook handling, secrets/deploy story for solo owner.
DSA: DataLoader batching (N+1→O(1) round-trips/tick); keyset pagination O(log n); hash idempotency key O(1).

**design-system-engineer** — Add: runtime theming (dark/contrast/density) via CSS custom-prop cascade + SSR-safe (no FOUC), compound/slot/polymorphic (`as`) + forwardRef, controlled-vs-uncontrolled contract, focus-trap/portal/scroll-lock, token versioning/codemod + tree-shaking.
DSA: roving tabindex O(1) (ARIA APG); token graph resolve (global→semantic→component) topological O(V+E); focus-order traversal O(n).

**mobile-engineer** — Add: in-app purchase/StoreKit/Billing, platform a11y (VoiceOver/TalkBack/Dynamic Type), navigation/back-stack + state restoration after process death, dynamic feature delivery + app-size budget, analytics SDK lifecycle.
DSA: CRDT/LWW merge (offline convergence); LRU image/disk cache O(1); lazy list recycling O(visible); backoff+jitter on resync.

**ux-flow-designer** — Add: quantitative UX (funnel/drop-off metrics + success criteria + instrumentation/event spec to eng), usability-test protocol + heuristic eval + A/B handoff to data-scientist, responsive/breakpoint + touch-target + reduced-motion specs, content/microcopy + i18n/RTL at design time.
DSA: flow as directed graph (DAG) — O(V+E) traversal, detect dead-ends/unreachable states; state-matrix as finite-state machine — enumerate state×event so no transition is undefined.

**computer-vision-engineer** — Add: tracking depth (Kalman/ReID/optical flow), annotation tooling + active/weak-supervised labeling, calibration (ECE/temp-scaling) + OOD detection, detection post-processing/anchor assignment, 3D/point-cloud + domain randomization, reproducible aug seeds.
DSA: NMS O(n log n) (+Soft-NMS); Hungarian O(n³) (DETR/SORT matching); Kalman O(1)/step; union-find O(nα(n)) (mask labeling); k-means (anchor clustering).

**ml-engineer** — Add: active learning + dataset versioning, online feature freshness SLAs + point-in-time joins, model cards + fairness slices + lineage, cost SLOs ($/1k-inf, MIG), drift→retrain automation + champion/challenger + shadow eval.
DSA: Adam/AdamW O(params)/step; ring all-reduce O(N) (NCCL); PagedAttention (vLLM); FlashAttention O(n) memory; PSI/KL/KS O(n) (drift); HNSW O(log n).

**blockchain-engineer** — Add: proxy specifics (UUPS vs Transparent, initializer/_disableInitializers, EIP-1967 slots), oracle/TWAP manipulation defense, gas optimization (storage packing, calldata, unchecked increments), EIP-712 signed-message + replay nonce, pull-over-push withdrawal.
DSA: Merkle tree O(log n) (allowlist/airdrop proof); Merkle-Patricia trie O(log n) (state proofs); binary-search-on-checkpoints O(log n) (ERC20Votes).

### Infra / reliability

**cloud-engineer** — Add: multi-region consistency (active-active vs passive, quorum, split-brain), committed-use/savings-plan modeling, service-quota launch blockers, cell-based blast-radius partitioning.
DSA: consistent hashing (ring/jump) O(log n); anycast+BGP shortest-path; bin-packing (FFD) for pod placement; token bucket O(1) (edge); HyperLogLog O(1).

**devops-engineer** — Add: IaC drift reconcile loop (Atlantis/scheduled plan), secret rotation lifecycle (short-TTL dynamic creds), SBOM + SLSA provenance, DORA metrics, hermetic build-cache correctness.
DSA: Merkle/content-addressed hashing O(1) (BuildKit layer cache); DAG topological sort O(V+E); backoff+jitter; Bloom filter O(1) (registry layer existence).

**site-reliability-engineer** — Add: explicit error-budget math (budget=(1−SLO)·window; burn 14.4x/1h, 6x/6h), load-shed/admission-control (priority queue, adaptive concurrency), SLO-driven autoscale targets, toil ROI, dependency-criticality + degradation matrix.
DSA: multi-window burn-rate AND-gate; ring buffer O(1) (CB failure rate); AIMD (adaptive concurrency); t-digest/HdrHistogram O(1) (true p99); token/leaky bucket O(1).

**release-manager** — Add: automated canary analysis gate (Argo Rollouts/Flagger metric auto-rollback), release-freeze/change-calendar, deployment rings (internal→ring0→broad), migration rollback + data backfill reversibility, DORA change-fail tracking.
DSA: semver precedence O(1); topological sort O(V+E) (migration order); commit-DAG traversal (changelog); sequential test/SPRT (early-stop canary).

### ML research / data science

**data-scientist** — Add: Bayesian A/B (posterior/expected-loss), switchback/cluster interference design, uplift/CATE (causal forest, T/X-learner), forecasting (ARIMA/Prophet/state-space), sample-ratio-mismatch hard gate.
DSA: bootstrap O(B·n) (CI); CUPED O(n) (variance reduction); mSPRT (anytime-valid); Welch-t/Mann-Whitney O(n log n); Benjamini-Hochberg O(m log m); PSM via k-d tree O(n log n).

**research-agent** — Add: source dedup/clustering + claim-graph synthesis, recency/credibility tiering, structured claim→evidence→confidence schema, coverage-saturation stop criterion.
DSA: BM25/TF-IDF (query planning); embedding+ANN/HNSW O(log n) (semantic dedup); MinHash/SimHash O(n) (near-dup); topological sort O(V+E); greedy set-cover O(n log n) (min source set).

**research-solution-architect** — Add: external-memory/cache-aware model (I/O complexity), parallel/lock-free/SIMD hot-path design, approximation/online algos with competitive ratios, numerical stability/conditioning.
DSA: HyperLogLog O(1)/O(log log n) space; Bloom/Cuckoo O(k); Count-Min Sketch O(1); HNSW/IVF-PQ O(log n); LSM-tree; reservoir sampling O(1).

### Architecture / process

**solution-architect** — Add: CAP/PACELC framing, ATAM quality-attribute scenarios, consistency-model choice (strong/eventual, saga/2PC) as deliverable, NFR/latency budget allocation across hops, tech-radar build-vs-buy rubric, API-versioning strategy.
DSA: Little's Law (L=λW) O(1) (capacity sizing); Universal Scalability Law (throughput ceiling); consistent hashing O(log n).

**team-orchestrator** — Add: explicit DAG artifact, critical-path across gates, parallelization (fan-out wave) analysis, RACI per step, rollback-on-gate-failure routing.
DSA: topological sort (Kahn) O(V+E) (+cycle detect); Critical Path Method O(V+E) (min end-to-end); graph coloring/level-sets O(V+E) (parallel waves).

**project-manager** — Add: PERT three-point estimation, burndown/burnup + velocity trend, Monte Carlo completion forecast, slack/float + critical-chain buffer, WIP limits + Little's Law cycle-time, change-control.
DSA: CPM O(V+E) (float, schedule risk); PERT β=(o+4m+p)/6 O(n); Monte Carlo O(iters·(V+E)).

**reverse-engineering-agent** — Add: call-graph/CFG construction deliverable, data-flow/taint slicing, dynamic analysis (tracing/debugger/instrumentation), coupling metrics + dead-code for migration scoping.
DSA: DFS/BFS O(V+E) (call-graph reachability); Tarjan SCC O(V+E) (cyclic coupling); dominator tree O(E·α(V)); program slicing on PDG O(V+E).

### Security / QA (read-only + test)

**security-engineer** — Add: DAST/IAST runtime proof-of-fix, CSP/SRI/security-headers deliverable, secure-SDLC artifacts (security requirements, abuse-case stories, security regression tests), incident/CVE runbook + coordinated disclosure, IaC misconfig remediation scope.
DSA: bcrypt/argon2 (O(2^cost) work factor); constant-time compare O(n) (timing-safe); Aho-Corasick O(n+m) (secret scan); taint DFS source→sink; Merkle/hash-chain O(log n) (audit log).

**security-auditor** — Add: CVSS v3.1/v4 scoring, KEV/EPSS exploitability prioritization, business-logic/IDOR-chaining/race abuse modeling, reachability analysis to cut SCA false-positives, remediation-retest expectations.
DSA: taint/dataflow reachability O(V+E) (CodeQL); call-graph+CFG analysis; Bloom filter O(1) (leaked-cred lookup); Shannon entropy O(n) (secret detection); Aho-Corasick O(n+m).

**compliance-officer** — Add: control-evidence/continuous-compliance monitoring, DPIA + data-classification method, vendor/sub-processor risk, retention-schedule + lawful-basis (RoPA) enforcement, breach-notification timelines (GDPR 72h/HIPAA 60d).
DSA: data-flow graph reachability (PII erasure completeness); greedy set-cover (controls gap-diff); topological sort (remediation order); regex/NER O(n) (PII location).

**qa-engineer** — Add: accessibility testing (WCAG/axe), risk-based test prioritization, cross-browser/device matrix, defect-leakage/escape-rate metrics, usability + i18n pseudo-loc testing.
DSA: pairwise/combinatorial (orthogonal arrays) — fewer cases cover interactions; equivalence-partition + boundary-value (minimal input set); delta-debugging ddmin O(log n) (minimize repro); decision tables.

**testing-engineer** — Add: mutation testing (Stryker/PIT — coverage≠assertion quality), flaky-test quarantine system, test-data/synthetic-data strategy, visual-regression (Playwright/Percy), test-impact-analysis (selective execution).
DSA: mutation testing (fault-inject kill-rate); test-DAG topological sort (shard scheduling); graph-coloring/bin-packing (balance CI shards); delta-debugging (minimize flaky repro); consistent hashing (stable test→shard).

---

## 4. Code-discipline rules  →  per-agent contract (your choice: per-agent, not universal)

Add to each builder agent's `enforce-mode contract`:

- **Fail loud, no fallbacks.** On an unexpected condition, raise a typed error naming the
  root cause (what failed, the input, the expected vs actual). Never silently fall back to a
  default, swallow an exception, or paper over a missing dependency — a hidden fallback
  masks the bug. (Aligns with universal `error-handling`: no empty catch.)
- **Readable by the user.** Code ships clean and self-explanatory: intent-revealing names,
  small functions, comments on *why* (not *what*), simple control flow over clever one-liners.
  A non-author should follow it on first read.

(Read-only/process agents — auditor, compliance, reverse-eng, PM, orchestrator, research,
release — get the fail-loud reporting half but not the "ship code" half.)

---

## 5. Overlap / duplication cleanup (your "clean overlapping rules" ask)

Ground truth from grep across `agents/`:
- `Stay in your department` — duplicated in **28/28** files.
- The 4 generic contract bullets (`Ground before acting` / `POV backed by ground truth` /
  `Report failures as-is` / `Verify before recommend`) — **~102 occurrences**, and they
  **restate `universal.md` Universal engineering rules** that every agent already inherits
  (verified). Pure redundancy.

Cleanup:
1. Slim each agent's `enforce-mode contract` to **department-specific lines only** (the
   domain-flavored "ground before acting" specialization + "stay in your department"). Drop
   the generic restatements that `universal.md` already provides.
2. `universal.md` NFR section (already added this session) is the single home for the
   non-functional rules — remove any per-agent restatement of those.
3. New `rules/mechanisms.md` is the single home for cross-cutting mechanisms — agents
   reference it, never copy the table.
4. Net effect: less text per agent, zero contradiction, one source per concept.

---

## 6. Execution plan (after approval)

Applied in the worktree, scripted for consistency (CRLF-aware), verified by grep + re-read:

1. Write `rules/mechanisms.md` (the §2 matrix) and wire it into the installer copy-list.
2. Per-agent edits (28 files): append §3 domain DSA block + §4 code-discipline lines;
   slim the contract per §5. One pass, idempotent script + spot-read verify.
3. Update `universal.md` reference to point at `rules/mechanisms.md`.
4. Re-run the two-file live copy (universal.md + new mechanisms.md) to `~/.claude`.
5. Verify: grep each agent has its DSA block; confirm no duplicated generic bullets remain;
   confirm install copied. Report counts.
6. Reminder: changes go live for subagents only on **next session** (rules cached at session
   start — verified this session).

Nothing is committed without your ask.
