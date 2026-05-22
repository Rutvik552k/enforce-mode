## Feature Flags Domain Rules

- [WARN] OWNER AND EXPIRY: Every feature flag must have an owner and an expiry date. Flags without expiry become permanent tech debt. Review and clean up flags quarterly.
- [WARN] CLEANUP STALE FLAGS: Remove feature flags within 30 days of full rollout. Dead flags increase code complexity and cognitive load. Track flag lifecycle in your feature flag platform.
- [WARN] NAMING CONVENTION: Use consistent naming for flags (e.g., `enable_<feature>`, `rollout_<feature>`). Include team prefix for ownership. Never reuse flag names after deletion.
- [STRICT] DETERMINISTIC EVALUATION: Flag evaluation must be deterministic for the same user/context. Use consistent hashing for percentage rollouts. Never use random evaluation that changes between requests.
- [STRICT] DEFAULT OFF: New feature flags must default to off in production. Enable progressively (1% -> 10% -> 50% -> 100%). Define rollback criteria before rollout.
- [STRICT] TESTING BOTH PATHS: Test both flag-on and flag-off code paths in CI. Feature flags double the state space — untested paths will break when toggled.
- [CRITICAL] NEVER GATE SECURITY: Security controls must never be behind feature flags. Authentication, authorization, encryption, and audit logging must always be active regardless of flag state.
- [STRICT] KILL SWITCHES: Every feature flag must support instant kill-switch capability to disable the feature in production without redeployment. Kill switches must bypass caching and take effect within seconds.
- [CRITICAL] AUDIT TRAIL: Log all flag state changes with who changed it, when, and why. Alert on unexpected flag changes in production. Maintain immutable history of all flag mutations.
