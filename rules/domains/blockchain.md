## Blockchain Domain Rules

- [WARN] CEI PATTERN: All state changes MUST follow Checks-Effects-Interactions pattern. Check conditions first, update state second, make external calls last. Prevents reentrancy class vulnerabilities.
- [WARN] UNCHECKED CALLS: Every `.call{}`, `.transfer()`, `.send()` return value MUST be checked. Unchecked external calls silently fail. Use `require(success)` or SafeTransferLib.
- [WARN] GAS BOUNDS: Loops iterating over unbounded arrays risk gas exhaustion. Cap iterations with `MAX_LENGTH` constant. Document gas budget per function.
- [WARN] ACCESS CONTROL: Every state-mutating function needs explicit access control. Use OpenZeppelin `Ownable` or `AccessControl`. Never rely on `tx.origin`.
- [STRICT] REENTRANCY GUARD: Functions making external calls to untrusted contracts MUST use `nonReentrant` modifier or manual lock. CEI alone is insufficient for complex interactions.
- [STRICT] INTEGER OVERFLOW: Solidity <0.8 requires SafeMath. Even >=0.8, use `unchecked` blocks intentionally with documented bounds. Casting between uint sizes needs explicit range validation.
- [STRICT] FRONTRUNNING: Functions with price-sensitive logic need slippage protection, commit-reveal schemes, or deadline parameters. Document MEV attack surface.
- [STRICT] UPGRADE SAFETY: Upgradeable contracts must not have storage collisions. Use OpenZeppelin's storage gap pattern. Never change storage layout ordering.
- [CRITICAL] PRIVATE KEY HANDLING: Never hardcode private keys, seed phrases, or deploy keys in source. Use environment variables + hardware wallets for deployment. Verify deployer address before mainnet.
- [CRITICAL] MAINNET DEPLOY: Before mainnet deployment: full audit trail, formal verification on critical paths, testnet deployment verified, emergency pause mechanism, timelock on admin functions.
