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

```bash
python scripts/e2e_go001.py
```

runs GO-001 through the **running product**: an opportunity created over HTTP,
ten artifacts uploaded through the real ingestion pipeline and scanned by
whatever clamd the API points at, analysis, review, commercial propositions,
estimate, all three deliverables and the audit trail. 66 assertions, nothing
mocked and nothing inserted behind the API's back. The Rust suite proves the
engine; this proves the product.

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

## Estimating and deliverables

Hours come from the organization's own effort templates, keyed by **(work
package, unit)**. Nothing else produces an hour figure — there is no model in
that path and no default ControlShift claims as universal.

- A work package with no template is reported **NOT PRICED** and excluded from
  the range, never silently valued at zero. `DISCOVERY` is deliberately
  template-less: its size is exactly what is unknown.
- Unknowns never become hours. They become a disclosed allowance decision.
- The three deliverables of SPEC 38 render from the stored `AnalysisResult`:
  Engineering Preflight, Proposal Input Package, Customer Information Request.
  Each scope line in the proposal package traces back
  `work package ← finding ← rule ← evidence`, and each document is written once
  to `storage/reports/` with its SHA-256; regenerating creates a new row.

## What the console can drive

The whole workflow, without curl: create an opportunity, upload artifacts, run
the analysis, review each finding, record the two human determinations,
propose and approve assumptions and exclusions, read the estimate, and generate
the three deliverables. Effort templates are editable under `/admin` by an
estimator or admin.

Two things the console deliberately makes visible rather than smoothing over:

- **Confirming the human determinations does not buy readiness.** On GO-001 it
  removes two of the five refusal reasons; the blockers, the critical unknowns
  and the 54% coverage remain, and fixed price stays NOT READY.
- **A verdict computed before the latest change is marked stale.** The stored
  analysis is never rewritten (SPEC 24), so the console compares the
  determinations recorded on the analysis against the ones in force now and
  asks for a re-analysis instead of silently showing an old answer.

## Dependency graph

Drawn as impact propagation, not as a hairball. 488 edges rendered at once tell
an engineer nothing; the chain that matters is the one SPEC 22 names:

```
slot 8 1747-SDN  --scans-->  DeviceNet  --nodes-->  UNDETERMINED
                 UNDETERMINED  <-- 8 MSG instructions target it
```

The eight MSG instructions hang off a **separate, undetermined** network node
rather than off DeviceNet, because nothing in the evidence says which network
they route over. Attaching them to DeviceNet would draw a route nobody
established.

Selecting a module shows what rests on it — `slot 6 - 1746-NI4`: three
addresses, three program files, finding `IO-003`. A Rust test pins the shared
namespace that link depends on.

## Report branding

All six configurable elements of SPEC 39: organization name and logo, customer
name and optional customer logo, report footer, and a prepared-by line under
the preparer's own name. Set under `/admin` by an org admin; the customer logo
is per opportunity.

The logo lands in an `<img src>` inside a document somebody forwards by email,
so the scheme is validated rather than trusted: base64 `data:` URIs of PNG,
JPEG, GIF or WEBP, capped at 256 kB. **SVG is refused** — it is a document
format that can carry script. The cover prints the preparer's name, never their
login.

## Application-layer boundaries

- **Tenancy and RBAC are tested, not asserted.** `services/api/src/tenancy.test.ts`
  boots the real app against the real database and proves a foreign tenant gets
  404 (never 403 - a wrong tenant must not learn a row exists), a Viewer gets
  403, and a forged token gets 401.
- **Originals are content-addressed and write-once.** Uploads land under
  `storage/original/<tenant>/<sha>` with `flag: 'wx'`. Re-analysis writes a new
  `Analysis` row; no assessment is ever overwritten.
- **An exclusion is not an exclusion until commerce approves it.** Proposals
  appear in the Proposal Input Package under `Proposed exclusions - NOT
  APPROVED`, and the scope above still carries them. Engineering validates
  assumptions, commerce approves exclusions, and neither role can perform the
  other's act (SPEC 37).
- **Propose from analysis drafts; it never approves.** It refuses to touch a
  `RESOLVE_BEFORE_QUOTE` unknown at all: that cannot be assumed away or excluded
  into safety, only answered.
- **Reviews sit beside findings, never on top of them.** An override records
  reviewer, reason and timestamp; the original finding stays in the stored
  `AnalysisResult`.
- **Malware scanning speaks clamd's INSTREAM protocol directly** — no
  dependency, and no third-party service: a customer's PLC source must not
  leave the deployment (SPEC 42), so an upload-to-cloud scanner is not an
  option. Point `CLAMD_HOST` at the `clamav` service in
  `infra/docker-compose.yml`.
- **The scanner fails closed.** Unreachable daemon, timeout, protocol garbage,
  size limit — every failure path returns UNAVAILABLE, never CLEAN. With no
  scanner configured, uploads stay `RECEIVED`, analysis refuses them, and the
  API says so at startup. `ALLOW_UNSCANNED_ARTIFACTS=true` overrides that for
  development only.
- **Infected bytes never reach the object store.** The scan runs before
  anything is written, so a rejection leaves nothing to clean up. The upload
  returns 400 with the signature and the rejection is audited.

Verified against a real ClamAV 1.5.3 with current signatures, not only against
the protocol stub:

```
POST /artifacts (EICAR)  ->  400 "rejected by malware scanning: Eicar-Test-Signature"
audit                    ->  artifact.rejected, signature recorded
artifact row             ->  none
object store             ->  nothing written
POST /artifacts (clean)  ->  201, processingStatus SCANNED
```

`scripts/smoke_scanner.sh` re-proves that against whatever clamd `CLAMD_HOST`
points at. See `docs/scanner-setup.md` for the two ways to get one running.
- **Intake refuses rather than inspects.** Archives and executables are rejected
  by extension; nothing is unpacked, so there is no archive bomb to bound.
- **An extension never decides a type that moves the verdict.** A `.pdf` lands
  as unclassified, contributing no evidence, until somebody says which drawing
  it is. Inferring ELECTRICAL_DRAWING from a network sketch dropped NETWORK
  coverage from 33% to 0, weighted coverage from 54% to 47%, and flipped
  BUDGETARY from READY WITH ALLOWANCES to NOT READY — with nobody typing
  anything wrong. The end-to-end run found that.

## Known ceilings

- Input is the **RSLogix 500 ASCII export**, not the binary `.SLC`. See
  `docs/slc-ascii-format.md` — the grammar is assumed and must be verified
  against a real customer export before the first pilot.
- A source the parser cannot read is BLOCKED, never quiet. Rungs survive an
  unrecognised header (`G1-017`), and `PARSE-001` fires when zero rungs come
  back or errors exceed 10% of them — otherwise a foreign header would produce
  an empty model and an assessment that reads as "nothing wrong".
- The golden is synthetic. It hits the SPEC 59 counts exactly; it does not
  contain the rarities a real 20-year-old project will.
- Rule predicates are a closed compiled registry, not an expression DSL.
  Rules stay versioned data; new *kinds* of check need an engine release.
- Analysis runs synchronously in the API process. Temporal (SPEC 49) is not
  wired; GO-001 analyzes in well under a second, so there is nothing to
  orchestrate yet.
- No reports (SPEC 38) and no estimating templates (SPEC 32) yet. The engine
  emits work packages with quantities; nobody has priced them.
- No PDF/photo extraction. Evidence that exists only inside a drawing is
  reported as missing, which is the correct V1 behaviour, not a gap to paper over.
