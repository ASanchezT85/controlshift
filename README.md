# ControlShift

Industrial Migration Preflight. Authority: `CONTROL SHIFT — MASTER SPECIFICATION V1`.

**V1 success criterion (SPEC 79):** ControlShift correctly analyzes `GO-001 — PKG-LINE-04`
from raw artifacts to commercial readiness without fabricating certainty.

## Current state

Deterministic core only. No web app, no API, no database yet — those wrap the
engine once the engine is right.

```
golden/atomic/G1-0xx/                      one migration condition per case
golden/composite/G2-0xx/                   interacting conditions + the readiness gate
golden/opportunities/GO-001-PKG-LINE-04/   synthetic golden opportunity + expected.json
engines/analysis/                          Rust: lexer -> parser -> IR -> graph -> rules
rulepacks/rockwell/RA-2026.08.json         versioned, deterministic migration rules
docs/slc-ascii-format.md                   the input grammar the parser is written against
scripts/gen_go001.py                       regenerates the golden (asserts SPEC 57/58/59)
```

## Run it

```bash
cargo run -- --request golden/opportunities/GO-001-PKG-LINE-04/request.json
```

```bash
cargo test
```

Adding a golden case is adding two files - `source.SLC` and `case.json` - under
`golden/atomic/` or `golden/composite/`. No Rust change. The suite refuses a rule
with no positive and negative fixture, and refuses a case that asserts nothing.

`cargo test` includes the GO-001 acceptance suite: every mandatory finding of
SPEC 60, the three migration paths of SPEC 61, the commercial decision of
SPEC 62, and one test per failure condition of SPEC 63. A false-safe result
fails the suite.

## The readiness gate is real, not hardcoded

`engineering_review_complete` and `shutdown_feasible` are human determinations the
engine cannot make. They arrive as request fields and default to **false** - absent
means not established, never assumed true. `G2-002` proves the gate reaches
FIXED_PRICE READY when they are declared and the evidence is complete; `G2-003` is
the same system with review incomplete and must not. Without that pair, the
NOT_READY of GO-001 would prove nothing.

## Known ceilings

- Input is the **RSLogix 500 ASCII export**, not the binary `.SLC`. See
  `docs/slc-ascii-format.md` — the grammar is assumed and must be verified
  against a real customer export before the first pilot.
- The golden is synthetic. It hits the SPEC 59 counts exactly; it does not
  contain the rarities a real 20-year-old project will.
- Rule predicates are a closed compiled registry, not an expression DSL.
  Rules stay versioned data; new *kinds* of check need an engine release.
- No PDF/photo extraction. Evidence that exists only inside a drawing is
  reported as missing, which is the correct V1 behaviour, not a gap to paper over.
