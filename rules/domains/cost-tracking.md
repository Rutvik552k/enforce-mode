## Cost Tracking Domain Rules

- [WARN] REPORT COST: Track and report cloud GPU/compute cost for every operation — instance cost/hour x estimated time. Include cost estimates in every benchmark result.
- [WARN] COST IN BENCHMARKS: When comparing approaches, include $/generation or $/request as a metric alongside latency and throughput.
- [STRICT] COST WARNING: Warn the user before any single operation estimated to cost more than $5 of GPU time. Get explicit confirmation before proceeding.
- [STRICT] CUMULATIVE LOG: Log cumulative session cost in session documentation. Track running total across all compute operations.
- [STRICT] INSTANCE AWARENESS: Research current cloud pricing before recommending instances. Compare spot vs on-demand. Consider auto-scaling implications.
- [CRITICAL] BUDGET GUARD: If cumulative session cost exceeds $50, halt compute operations and report to user. Require explicit override to continue.
- [CRITICAL] EGRESS COSTS: For large output files (video, model weights), factor in network egress costs. Use CDN for delivery. Compress where possible.
