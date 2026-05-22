## Testing Domain Rules

- [WARN] CONTRACT TESTS: Maintain contract tests for all API boundaries between services. Contracts verify that producers and consumers agree on request/response schemas. Run contract tests in CI on every change.
- [WARN] COVERAGE RATCHET: Coverage must never decrease between commits. Use a coverage ratchet that fails CI if coverage drops below the current baseline. Gradually increase coverage floor over time.
- [STRICT] LOAD TESTS WITH SLO: Run load tests against defined SLO thresholds (p99 latency, error rate, throughput). Fail CI if performance degrades beyond acceptable bounds. Test with realistic traffic patterns and data volumes.
- [STRICT] ACCESSIBILITY TESTS: Include automated accessibility tests validating WCAG 2.1 AA compliance. Test keyboard navigation, screen reader compatibility, color contrast, and ARIA attributes. Block merges that introduce a11y regressions.
- [CRITICAL] NO REAL EXTERNAL SERVICES: Integration tests must never call real external services (payment APIs, email providers, third-party APIs). Use stubs, fakes, or contract-verified mocks. Real service calls cause flaky tests, cost money, and risk side effects.
