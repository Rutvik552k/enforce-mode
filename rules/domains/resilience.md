## Resilience Domain Rules

- [WARN] TIMEOUT CONFIGURATION: Every outbound call (HTTP, RPC, database) must have an explicit timeout. Never use infinite or platform-default timeouts. Document timeout values and rationale.
- [WARN] GRACEFUL DEGRADATION: Design features to degrade gracefully when dependencies fail. Cache last-known-good responses. Serve stale data rather than errors when appropriate.
- [WARN] HEALTH DEPENDENCY MAPPING: Map all service dependencies and their failure modes. Classify as critical vs non-critical. Non-critical dependency failure must not take down the service.
- [STRICT] CIRCUIT BREAKERS: Wrap calls to external services with circuit breakers. Configure failure threshold, recovery timeout, and half-open probing. Monitor circuit state transitions.
- [STRICT] RETRY WITH BACKOFF: Retries must use exponential backoff with jitter. Set max retry count (3-5). Never retry non-idempotent operations without idempotency keys. Distinguish retriable vs fatal errors.
- [STRICT] BACKPRESSURE: Apply backpressure when downstream systems are slow. Use bounded queues, rate limiters, or load shedding. Reject excess load with 429/503 rather than queueing unboundedly.
- [CRITICAL] BULKHEAD ISOLATION: Isolate resources (thread pools, connection pools) per dependency. One slow dependency must not exhaust resources for others. Use separate pools for critical vs non-critical paths.
- [CRITICAL] CHAOS TESTING: Regularly inject failures (network delays, service outages, disk pressure) in non-production environments. Verify resilience mechanisms activate correctly under real failure conditions.
