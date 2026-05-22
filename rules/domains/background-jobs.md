## Background Jobs Domain Rules

- [WARN] IDEMPOTENT HANDLERS: Job handlers must be idempotent — safe to retry without side effects. Use idempotency keys or check-before-act patterns. Assume at-least-once delivery.
- [WARN] TIMEOUT LIMITS: Every job must have a maximum execution timeout. Kill and retry jobs that exceed timeout. Default timeout should be explicit, not infinite.
- [WARN] BACKOFF STRATEGY: Failed jobs must retry with exponential backoff plus jitter. Never retry immediately in a tight loop. Cap maximum retry count (typically 3-5).
- [STRICT] DEAD LETTER QUEUE: Jobs that exhaust retries must move to a dead-letter queue for inspection. Never silently drop failed jobs. Alert on DLQ growth.
- [STRICT] NO SECRETS IN PAYLOADS: Job payloads must not contain secrets, tokens, or credentials. Pass references (user ID, resource ID) and look up secrets at execution time.
- [STRICT] OBSERVABILITY: Every job must log start, completion, and failure with job ID, duration, and retry count. Emit metrics for queue depth, processing time, and failure rate.
- [CRITICAL] RESOURCE CLEANUP: Jobs that acquire resources (files, connections, locks) must release them in a finally block. Implement cleanup on timeout and crash.
- [CRITICAL] CONCURRENCY CONTROL: Jobs operating on shared resources must use distributed locks or optimistic concurrency. Prevent duplicate processing of the same work item.
