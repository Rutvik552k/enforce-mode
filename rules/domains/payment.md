## Payment Domain Rules

- [WARN] INTEGER CENTS: Store and compute monetary amounts as integer cents (or smallest currency unit). Never use floating-point for money. Use Decimal/BigDecimal for display conversion.
- [WARN] CURRENCY HANDLING: Always store currency code alongside amount. Never assume USD. Use ISO 4217 currency codes. Handle multi-currency with explicit conversion tracking.
- [STRICT] TOKENIZATION: Never store raw card numbers (PAN) in your system. Use payment processor tokenization (Stripe tokens, Braintree nonces). Minimize PCI scope.
- [STRICT] IDEMPOTENCY KEYS: All payment operations must include an idempotency key. Retries must produce the same result. Store idempotency key with transaction to prevent double-charge.
- [STRICT] WEBHOOK VERIFICATION: Verify webhook signatures from payment processors before processing. Reject unverified webhook payloads. Use the processor's SDK signature verification.
- [STRICT] RECONCILIATION: Implement daily reconciliation between your ledger and payment processor. Flag and alert on discrepancies. Never silently ignore mismatches.
- [CRITICAL] NO PAN IN LOGS: Never log full card numbers, CVV, or raw payment credentials. Mask card numbers to last 4 digits. PCI DSS requires this — violations are audit failures.
- [CRITICAL] REFUND CONTROLS: Refund operations must require authorization, have amount limits, and create audit trail. Never allow unbounded programmatic refunds without human approval.
- [CRITICAL] PAYMENT STATE MACHINE: Payment lifecycle must follow a strict state machine (pending -> authorized -> captured -> settled). No skipping states. Log every transition.
