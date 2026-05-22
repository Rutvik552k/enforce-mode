## Licensing Domain Rules

- [WARN] LICENSE HEADERS: All source files must include a license header comment matching the project's license. Use SPDX identifier format. Automate header insertion with CI checks.
- [STRICT] SBOM GENERATION: Generate an SBOM (CycloneDX or SPDX) with each release listing all dependencies and their licenses. Include in release artifacts for compliance review.
- [STRICT] LICENSE COMPATIBILITY: Check license of every new dependency before adding. Maintain an approved license list. Flag unknown or custom licenses for legal review. Ensure all dependency licenses are compatible with the project license.
- [STRICT] GPL DETECTION: Detect and flag GPL/AGPL/LGPL dependencies in proprietary projects. Copyleft licenses may require open-sourcing your code. Block merges that introduce copyleft without legal approval.
- [CRITICAL] COPYLEFT CONTAMINATION: Ensure copyleft-licensed code is isolated and does not contaminate proprietary modules through static linking or direct inclusion. Use dynamic linking or separate processes if needed.
- [STRICT] DUAL LICENSE CLARITY: If offering dual licensing, document which license applies in which context. Include LICENSE file at repo root. Ensure contributors sign CLA or DCO.
- [CRITICAL] LICENSE FILE: Repository must have a LICENSE file at the root. License must match package.json/pyproject.toml license field. Any discrepancy is a compliance violation.
- [CRITICAL] THIRD PARTY NOTICES: Distribute a THIRD-PARTY-NOTICES or ATTRIBUTION file listing all bundled dependencies, their licenses, and copyright holders. Required for binary distributions.
