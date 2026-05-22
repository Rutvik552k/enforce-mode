## Caching Domain Rules

- [WARN] CACHE KEY NAMING: Use structured, namespaced cache keys with version prefix (e.g., `v1:users:42:profile`). Include relevant identifiers for debuggability. Never use opaque or auto-generated keys without human-readable components.
- [STRICT] TTL REQUIRED: Every cache entry must have an explicit TTL. Never cache without expiration — unbounded caches cause stale data, memory leaks, and subtle consistency bugs. Set TTL based on data volatility and acceptable staleness.
- [STRICT] STAMPEDE PREVENTION: Protect against cache stampedes (thundering herd) using techniques like lock-based recomputation, probabilistic early expiration, or request coalescing. A single cache miss must not trigger N concurrent backend queries.
- [STRICT] INVALIDATION STRATEGY: Define and document an explicit invalidation strategy for every cached entity (TTL-based, event-driven, write-through, or write-behind). Ad-hoc invalidation leads to stale data and inconsistency across services.
- [CRITICAL] NO PII IN SHARED CACHE: Never store personally identifiable information (PII), authentication tokens, or sensitive user data in shared or distributed caches (Redis, Memcached). Use per-user scoped caches with encryption if caching user data is required.
