## GPU Hardware Domain Rules

- [WARN] CHECK HARDWARE: Before recommending any model size or loading strategy, check target instance specs — GPU count, VRAM per GPU, CPU RAM, disk space. Use nvidia-smi or equivalent.
- [WARN] MEMORY MATH: Calculate VRAM requirement as (parameters x bytes_per_param) + activation_memory + optimizer_states. State this alongside every model recommendation. If model doesn't fit, find another approach — don't guess.
- [WARN] MULTI-GPU VERIFY: Before assuming multi-GPU support, web-search to verify the specific framework version supports DataParallel/FSDP/DeepSpeed/tensor parallel. Check actual GitHub issues, not just docs.
- [STRICT] OOM PREVENTION: Always estimate peak VRAM usage and compare against available VRAM before launching. Track peak memory, not just average — OOM happens at peak.
- [STRICT] CPU OFFLOAD CHECK: If CPU RAM < model size, do NOT suggest CPU offloading. Find a smaller model or quantized version.
- [CRITICAL] COST PER OPERATION: Report estimated GPU cloud cost for every compute operation (instance $/hr x estimated time). Warn before operations exceeding $5.
