## IaC Security Domain Rules

- [STRICT] LEAST PRIVILEGE IAM: IAM policies must follow least privilege. No wildcard actions (`*`) or wildcard resources. Scope permissions to specific services, actions, and resources.
- [WARN] SECURITY GROUP REVIEW: Review security group and firewall rules in every PR. Document the purpose of each rule. Remove unused rules quarterly.
- [WARN] LOGGING ENABLED: Enable access logging on all load balancers, API gateways, and storage buckets. Send logs to centralized logging. Retain per compliance requirements.
- [CRITICAL] NO OPEN INGRESS: No security groups or firewall rules allowing `0.0.0.0/0` ingress on management ports (SSH/22, RDP/3389). Use bastion hosts or VPN for admin access.
- [CRITICAL] ENCRYPT AT REST: Enable encryption at rest for all storage services (S3, EBS, RDS, DynamoDB). Use customer-managed keys (CMK) for sensitive data. Rotate keys annually.
- [CRITICAL] NO PUBLIC STORAGE: S3 buckets, GCS buckets, and Azure Blob containers must block public access by default. Use pre-signed URLs for temporary access. Audit public access settings.
- [STRICT] NETWORK SEGMENTATION: Separate workloads into VPC subnets by tier (public, private, data). Database subnets must have no internet access. Use NAT gateways for outbound only.
- [CRITICAL] SECRET MANAGEMENT: Never store secrets in IaC source files, tfvars, or environment variables in CI config. Use Vault, AWS Secrets Manager, or sealed-secrets. Reference secrets by ARN/path.
- [CRITICAL] COMPLIANCE SCANNING: Run IaC security scanning (Checkov, tfsec, Bridgecrew) in CI. Block merges with critical misconfigurations. Scan for CIS benchmark violations.
