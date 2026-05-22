## Container Security Domain Rules

- [WARN] MINIMAL BASE IMAGE: Use minimal base images (Alpine, distroless, scratch). Remove build tools, shells, and package managers from production images. Smaller image = smaller attack surface.
- [WARN] RESOURCE LIMITS: Set CPU and memory limits on all containers. Define resource requests for scheduling. Never run containers with unlimited resources in production.
- [WARN] IMAGE TAGGING: Never use `latest` tag in production. Pin to specific digest or semantic version. Tag images with build SHA and version for traceability.
- [STRICT] NO ROOT: Run containers as non-root user. Set `USER` directive in Dockerfile. Drop all Linux capabilities and add back only what's needed. Use `readOnlyRootFilesystem` where possible.
- [STRICT] NETWORK POLICIES: Define Kubernetes NetworkPolicies to restrict pod-to-pod communication. Default deny all ingress/egress, then allowlist required traffic. No open network access between namespaces.
- [STRICT] SECRET MANAGEMENT: Never embed secrets in container images or environment variables in pod specs. Use Kubernetes Secrets (encrypted at rest), Vault, or sealed-secrets. Mount secrets as files, not env vars.
- [CRITICAL] CVE SCANNING: Scan images in CI and in registry continuously. Block deployment of images with critical unpatched CVEs. Alert on newly discovered CVEs in running images.
- [CRITICAL] IMMUTABLE CONTAINERS: Production containers must be immutable — no SSH, no shell exec in production. Debug with ephemeral containers or log aggregation. Rebuild and redeploy, never patch in place.
