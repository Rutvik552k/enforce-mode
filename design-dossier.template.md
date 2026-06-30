# Design Dossier — <feature/service>

One section per non-trivial feature. Ground the design in how production systems
actually solved the same algorithmic class — then reverse-engineer and adapt.
**Hallucination guard:** every "company X uses algorithm Y" claim needs a REAL
cited source (eng blog / paper / talk). No source → tag `UNVERIFIED` and do not
let it drive the design.

## <feature id — match dependency-map.json / constraints.json>

- **Problem:** what must be solved, and the hard constraint (from constraints.json).
- **Algorithmic class:** e.g. rate limiting / approximate membership / nearest-neighbor / consensus / stream dedup.
- **How production systems solved it (≥2, cited):**
  | System / company | Approach / named algorithm | Source (URL / paper / talk) |
  |---|---|---|
  | <e.g. Stripe> | <e.g. token bucket> | <https://… or UNVERIFIED> |
  | <e.g. Cloudflare> | <e.g. sliding-window counter> | <https://… or UNVERIFIED> |
- **Chosen approach + why:** which one fits THIS problem's constraints, and the trade-off rejected.
- **Complexity:** time + space Big-O of the chosen approach.
- **Adaptation:** what we change vs the reference, and why (our constraints differ how).
- **Failure modes considered:** what breaks at scale / under partial failure.
