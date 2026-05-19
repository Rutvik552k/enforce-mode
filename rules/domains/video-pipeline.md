## Video Pipeline Domain Rules

- [WARN] PARALLEL EXECUTION: Run ffmpeg, video encoding/decoding, and long media processing in background. Report progress via subagent monitoring. Never let main agent sit idle during generation.
- [WARN] STREAMING FIRST: Prefer streaming/chunked processing over loading full video into memory. Use frame iterators, pipe-based processing, memory-mapped I/O where possible.
- [WARN] CODEC AWARENESS: Verify codec compatibility before transcoding. Check target platform requirements. Calculate throughput in frames/second and seconds-of-video/minute.
- [WARN] TEMP CLEANUP: Always clean up intermediate video files after pipeline completion. Use temp directories with automatic cleanup.
- [STRICT] RESOURCE LIMITS: Set explicit memory limits, timeouts, and max duration/resolution/frame-count per processing task. Design for graceful degradation under load.
- [STRICT] QUALITY GATES: Validate output quality — check frame count, resolution, duration, codec matches expected. Don't mark pipeline complete without verification.
- [CRITICAL] WATERMARKING: Production-generated videos must include provenance watermark. Detect and block harmful content generation.
