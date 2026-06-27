# enforce-mode — mechanisms.md (inherited cross-cutting mechanisms)

Installed to `~/.claude/rules/mechanisms.md` and loaded as a global rule alongside
`universal.md`. This is the single source for **cross-cutting mechanisms** — capabilities an
engineer pulls in *only when the solution needs them*. Rate limiting is not "always on"; a
backend building a public API **inherits** it, a frontend rendering a form does not.

Rule for every agent: when your solution hits a trigger below, you inherit that mechanism —
implement it with the named algorithm and state its Big-O. Do not re-invent it; do not copy
this table into your own definition — reference it.

| Mechanism | Inherited WHEN (trigger) | Algorithm / data structure | Big-O | Inheriting agents |
|---|---|---|---|---|
| Rate limiting / quota | public or multi-tenant endpoint; auth brute-force surface | Token bucket (smooths bursts), leaky bucket, sliding-window counter | O(1) | backend, cloud, sre, security, ai-application |
| AuthN/AuthZ | any user-facing or service entry point | JWT + refresh rotation, OAuth2/OIDC, RBAC/ABAC, object-level (BOLA) check | O(1) verify | backend, fullstack, security, mobile |
| Idempotency / replay-safety | retried mutation, webhook, on-chain tx | hash/UUID idempotency key + stored result; nonce | O(1) dedup | backend, data, fullstack, security, blockchain |
| Caching | hot read path, expensive recompute | LRU (O(1) get/evict), LFU, read-through/write-back; semantic cache (LLM) | O(1) | backend, frontend, database, ai-application, mobile |
| Retry + backoff | transient outbound failure | exponential backoff + jitter (kills thundering herd) | O(1)/attempt | backend, sre, devops, mobile, ai-application |
| Circuit breaker | call to untrusted/slow dependency | ring-buffer failure-rate + half-open probe | O(1) | backend, sre, cloud, ai-application |
| Bulkhead / backpressure | shared resource under load | bounded queue, isolated pools, AIMD admission control | O(1) | backend, sre |
| Connection pooling | DB / network resource reuse | bounded pool + validation (PgBouncer-style) | O(1) checkout | backend, database |
| Pagination | list endpoint over growing data | keyset/cursor (seek), not OFFSET | O(log n) seek | backend, fullstack, database |
| Debounce / throttle | high-frequency UI/network events | leading/trailing time gate | O(1) | frontend, mobile |
| Virtualization / windowing | long list render | render only the visible window | O(visible) | frontend, mobile, design-system |
| Optimistic update + rollback | mutating UI action | apply-then-reconcile + compensating revert | O(1) | frontend, fullstack, mobile |
| Offline queue + replay | intermittent connectivity (mobile) | durable queue + idempotent replay + backoff | O(1) enqueue | mobile |
| Input validation | any untrusted input | schema guard (Zod/Pydantic), allow-list | O(n) | all builders, security |
| Autoscaling | variable load | target-tracking / step (HPA/Karpenter); bin-packing placement | NP-hard → greedy | cloud, sre, devops |
| Progressive delivery | production deploy | blue-green, canary + auto-analysis, feature-flag/kill-switch | — | devops, sre, release, cloud |
| Checkpointing | long training / preemptible compute | periodic state snapshot + resume | O(state) | ml, computer-vision |
| Quantization / pruning | model serving cost/latency | int8/int4 (GPTQ/AWQ), structured prune | — | ml, computer-vision |
| Vector retrieval | semantic search / RAG | HNSW ANN, IVF-PQ at scale | ~O(log n) | ai-application, ml, research |
| Dependency DAG + critical path | multi-step plan / pipeline | topological sort (Kahn) + Critical Path Method | O(V+E) | team-orchestrator, project-manager, release, devops |
| Reentrancy guard / access control | external call from a contract | CEI + nonReentrant lock; OZ AccessControl | O(1) | blockchain |

Persistence: loaded every session as a global rule, same as universal.md.
