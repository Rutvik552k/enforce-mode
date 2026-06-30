# Design Dossier — enforce-mode

Prior-art grounding for the algorithmic patterns the plugin recommends (the
`rules/mechanisms.md` matrix). Each entry cites how production systems solved the
class, so agents adapt a vetted approach instead of inventing a tutorial one.
Hallucination guard: claims without a real source are tagged `UNVERIFIED`.

## rate-limiting (mechanisms.md)

- **Problem:** bound request rate per client on a public/multi-tenant endpoint without starving bursts.
- **Algorithmic class:** rate limiting / traffic shaping.
- **How production systems solved it (cited):**
  | System | Approach | Source |
  |---|---|---|
  | Stripe | token bucket (per-key) | https://stripe.com/blog/rate-limiters |
  | Cloudflare | sliding-window counter | https://blog.cloudflare.com/counting-things-a-lot-of-different-things/ |
  | Generic/Google SRE | leaky bucket / admission control | https://sre.google/sre-book/handling-overload/ |
- **Chosen approach:** token bucket — O(1) check, smooths bursts; sliding-window when exactness matters.
- **Complexity:** O(1) time, O(1) space per key.
- **Adaptation:** advisory only in this plugin (no real traffic) — the matrix recommends it to agents building real endpoints.

## vector-retrieval (mechanisms.md)

- **Problem:** sub-linear nearest-neighbor over high-dim embeddings (RAG/semantic search).
- **Algorithmic class:** approximate nearest neighbor (ANN).
- **How production systems solved it (cited):**
  | System | Approach | Source |
  |---|---|---|
  | HNSW (Malkov & Yashunin) | hierarchical navigable small-world graph | https://arxiv.org/abs/1603.09320 |
  | FAISS (Meta) | IVF-PQ at billion scale | https://arxiv.org/abs/1702.08734 |
- **Chosen approach:** HNSW for ~O(log n) query; IVF-PQ when memory-bound at huge scale.
- **Complexity:** ~O(log n) query; index build O(n log n).
- **Adaptation:** referenced by ai-application-engineer / ml-engineer for RAG design.

## sharding / load distribution (mechanisms.md)

- **Problem:** distribute keys across nodes with minimal reshuffle on scale-out.
- **Algorithmic class:** consistent hashing.
- **How production systems solved it (cited):**
  | System | Approach | Source |
  |---|---|---|
  | Amazon DynamoDB | consistent hashing + virtual nodes | https://www.amazon.science/publications/dynamo-amazons-highly-available-key-value-store |
  | Original (Karger et al.) | consistent hashing ring | https://dl.acm.org/doi/10.1145/258533.258660 |
- **Chosen approach:** consistent hashing with virtual nodes — O(log n) lookup, ~K/n keys move per node change.
- **Complexity:** O(log n) lookup, O(1) amortized rebalance per key.
- **Adaptation:** referenced by backend / database / cloud agents for sharding decisions.
