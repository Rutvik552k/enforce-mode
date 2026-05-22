## Observability Domain Rules

- [WARN] STRUCTURED LOGS: All logs must be structured JSON with timestamp, level, service, and correlation ID. No unstructured printf-style logging in production.
- [WARN] HEALTH CHECKS: Every service must expose `/health` and `/ready` endpoints. Health checks must verify downstream dependencies, not just return 200.
- [WARN] LOG LEVELS: Use appropriate log levels — DEBUG for development, INFO for normal operations, WARN for recoverable issues, ERROR for failures. Never log at ERROR for expected conditions.
- [STRICT] DISTRIBUTED TRACING: All inter-service calls must propagate trace context (W3C Trace Context or B3). Instrument entry points, outbound calls, and async boundaries.
- [STRICT] SLO DEFINITION: Every user-facing service must define SLOs for latency (p50/p95/p99) and availability. Alert on burn rate, not raw threshold.
- [STRICT] METRIC CARDINALITY: Metric labels must have bounded cardinality. Never use user IDs, request IDs, or unbounded strings as metric labels.
- [CRITICAL] NO PII IN LOGS: Never log passwords, tokens, credit card numbers, SSNs, or other PII. Scrub or mask sensitive fields before logging.
- [CRITICAL] ALERT ACTIONABILITY: Every alert must have a runbook link and clear owner. No alerts that fire without a defined response action.
