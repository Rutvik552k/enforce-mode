## LLM Safety Domain Rules

- [WARN] TOKEN BUDGETS: Set explicit max token limits on all LLM API calls. Monitor token usage per request and per user. Alert on cost anomalies or runaway generation.
- [WARN] CONTENT FILTERING: Apply content safety filters on both LLM input and output. Block or flag harmful, illegal, or policy-violating content before it reaches users.
- [WARN] HALLUCINATION GUARDS: Never present LLM output as factual without verification. Add disclaimers for generated content. Cross-reference critical claims against authoritative sources.
- [STRICT] PROMPT INJECTION: Sanitize all user-supplied text before including in LLM prompts. Use clear system/user message boundaries. Never allow user input to override system instructions.
- [STRICT] OUTPUT SANITIZATION: Treat all LLM output as untrusted. Sanitize before rendering as HTML, executing as code, or using in database queries. Never eval() LLM output.
- [STRICT] MODEL ACCESS CONTROL: Restrict which models and capabilities are available per user tier. Rate-limit LLM API calls per user. Implement spend caps per account.
- [CRITICAL] NO SECRETS IN PROMPTS: Never include API keys, credentials, or internal system details in LLM prompts. Assume prompts may be logged or extracted via prompt injection.
- [CRITICAL] EXECUTION SANDBOXING: If LLM output is executed (code generation, tool use), run it in a sandboxed environment with restricted permissions, network access, and resource limits.
