## ML Inference Domain Rules

- [WARN] BACKGROUND INFERENCE: ALL model inference, generation, weight conversion, or GPU tasks MUST run in background subagents. Main agent MUST NOT execute inference directly or wait for it. Launch background, immediately continue with productive parallel work.
- [WARN] ARCHITECTURE FIRST: Before writing ANY implementation code for a model — read the official repo/paper/docs, identify backbone type, attention mechanism, VAE type, text encoder. Document architecture BEFORE writing pipeline code.
- [WARN] VERIFY WEIGHTS: Before recommending any model, web-search to confirm weights are downloadable on HuggingFace or GitHub. Verify license matches claims. If weights are API-only, say so explicitly.
- [WARN] PIPELINE FLOW: Document inference pipeline flow — what components run in sequence, which is the bottleneck, where tensors transfer between devices, peak activation memory per component.
- [STRICT] SUBAGENT GPU: Every model forward pass, weight conversion, VAE encode/decode, or benchmark run MUST be dispatched to a background subagent. Anti-pattern: running `python inference.py` in foreground and waiting.
- [STRICT] DECISION LOCK: Never change an agreed-upon model, architecture, or approach without explicitly asking the user first. If something is unavailable, STOP and present verified alternatives.
- [CRITICAL] WEIGHT INTEGRITY: Verify model weight checksums after download. Never load unchecked weights into GPU memory. Report file sizes and hash verification.
