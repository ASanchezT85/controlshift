# ControlShift

**Industrial migration preflight for Allen-Bradley SLC 500 → CompactLogix.**

Turns legacy PLC exports and incomplete documentation into scope, unknowns and
quote-readiness — before an integrator commits to a fixed price.

Nothing here touches a controller. ControlShift reads copies of offline
artifacts: it never opens a session with a PLC, never scans an OT network,
never uploads, never downloads, and never modifies a project file in place.
That is not a promise in a document, it is the shape of the code — there is no
industrial protocol library in the dependency tree to do it with.

![engine](https://img.shields.io/badge/engine-Rust%201.98-b7410e)
![api](https://img.shields.io/badge/api-Node%2022%20%C2%B7%20NestJS-3178c6)
![db](https://img.shields.io/badge/db-PostgreSQL%2017-336791)
![status](https://img.shields.io/badge/status-V1%20in%20progress-8a5a00)
![license](https://img.shields.io/badge/license-MIT-1e6b3a)

---

## What it answers

A system integrator is handed an old PLC program, drawings from 2014, some
photos, no HMI backup, no drive parameters, a 12-hour shutdown window and a
request for a fixed price. The question is not *"how do I convert this
program?"* It is:

> **What exactly am I agreeing to deliver if I quote this?**

ControlShift answers, for one migration opportunity:

| Question | Where it comes from |
|---|---|
| What is in the existing control system? | deterministic parse of the program export |
| How complete is the evidence? | ten weighted coverage domains |
| What depends on what? | reconstructed dependency graph |
| What blocks a migration, and why? | versioned rule pack, 20 rules |
| What is simply unknown? | an uncertainty register, never a guess |
| What work does that imply? | work packages in the eleven scope sections |
| What does that cost? | the organization's own effort templates |
| Can this be fixed-priced at all? | a deterministic gate that says why not |

## Requirements

- **Rust 1.98+** for the analysis engine
- **Node 22+** for the API and the console
- **PostgreSQL 17** (`infra/docker-compose.yml` brings one up)
- **Python 3.12+** for the golden generator and the end-to-end run
- **clamd**, optional but recommended — without it, uploads are refused by
  analysis rather than quietly accepted

## Install

```bash
docker compose -f infra/docker-compose.yml up -d
cargo build --release
npm --prefix services/api ci && npm --prefix services/api run migrate && npm --prefix services/api run build
node services/api/dist/seed.js
```

Then, from `services/api`, `node dist/main.js`, and `npm --prefix apps/web run
dev`. API on `127.0.0.1:3000/api`, console on `localhost:3100`. The seed creates
one user per role in the `Northstar Integrators` tenant, password
`controlshift-dev`.

## Commands

| Command | What it does |
|---|---|
| `scripts/verify.sh` | every layer, one verdict — **run this before every commit** |
| `scripts/e2e_go001.py` | GO-001 through the running product, 73 assertions |
| `scripts/gen_go001.py` | regenerates the golden, asserting MASTER SPEC 57/58/59 |
| `scripts/conform.py <file>` | how much of a real export the grammar reads |
| `scripts/validate_export.py <file>` | the three questions a real `.SLC` settles |
| `scripts/smoke_scanner.sh` | proves the scanner flags EICAR and passes a clean rung |
| `cargo run -- --request <request.json>` | the engine alone, JSON in, JSON out |

## The rule that governs everything: UNKNOWN stays UNKNOWN

Missing evidence never becomes PASS, compatible, complete, safe or not
applicable. No safety PLC in the supplied files does not mean safety is out of
scope; it means **safety is insufficiently evidenced**, and that is what the
system says.

Everything else follows from it:

- **No PASS findings exist in V1.** A rule that fires produces CONDITIONAL,
  REVIEW_REQUIRED, UNKNOWN or BLOCKED. A test enforces it on every golden case.
- **A source the parser cannot read is BLOCKED, never quiet.** Rungs survive an
  unrecognised header; `PARSE-001` fires when zero rungs come back. Otherwise a
  foreign format would produce an empty model and an assessment that reads as
  "nothing wrong".
- **The scanner fails closed.** Unreachable daemon, timeout, protocol garbage —
  every path returns UNAVAILABLE, never CLEAN.
- **An extension never decides a type that moves the verdict.** A `.pdf` lands
  unclassified until a person says which drawing it is.
- **The BOM is stamped CANDIDATE — NOT RELEASED FOR PROCUREMENT**, in the
  console and in every report.
- **AI is absent.** Not optional-and-unused: there is no model in any path.
  Coverage percentages, findings, hours and readiness are arithmetic.

## The golden opportunity

`GO-001 — PKG-LINE-04` is the acceptance case, and it is deliberately a mess: a
1747-L553 in a ten-slot chassis, 21 program files, 684 rungs, 4,231
instructions, a 1747-SDN scanner, and **no HMI backup, no drive parameters, no
DeviceNet configuration, drawings that predate a rebuild**.

It must conclude:

```
FIXED PRICE          NOT READY
BUDGETARY            READY WITH ALLOWANCES
TIME AND MATERIAL    READY
```

and it must reach that conclusion for stated reasons — two critical unknowns,
two blocking findings, 54% weighted coverage. Confirming the two human
determinations closes exactly two of the five refusal reasons and **fixed price
stays refused**; a composite case proves the gate can reach READY, so the
NOT_READY is a result rather than a constant.

The suites fail if ControlShift misses either IIM, marks a PID verified, invents
HMI effort, assumes safety is absent, or treats an OEM catalog mapping as a
field-compatibility guarantee.

## Architecture

```
engines/analysis/          Rust. Lexer -> parser -> IR -> dependency graph -> rules
  src/lexer.rs             line tokenizer with columns, for diagnostics
  src/parser.rs            SLC ASCII; never panics, diagnoses instead
  src/ir.rs                Control IR; vendor opcode preserved beside the normalized one
  src/engine.rs            coverage, rules, paths, work packages, BOM, readiness
  src/model.rs             the versioned request/result contract

rulepacks/rockwell/        20 rules, coverage domains, I/O mapping, scope sections
golden/                    19 atomic cases, 4 composite, and GO-001
services/api/              NestJS + Fastify + Prisma. Tenancy, intake, review, reports
apps/web/                  Next.js console, sixteen modules
scripts/                   verification, golden generation, format conformance
docs/                      the input grammar, customer intake, scanner setup
```

The engine is a separate process with a versioned JSON contract. It reads only
the artifacts a request names, and Rust internals never leak into what the
application stores.

## Rule packs

Rules are versioned data, not code. A rule names a compiled predicate, its
category, state, severity, the work packages it raises, the unit it counts in,
and the OEM publication behind it:

```json
{
  "id": "SW-003",
  "predicate": "opcode_count",
  "args": { "opcode": "IIM" },
  "state": "BLOCKED",
  "unit_type": "INSTRUCTION",
  "title": "IIM instances require manual rewrite",
  "work_packages": ["UNSUPPORTED_INSTRUCTION_REWRITE", "PLC_PROGRAM_REVIEW", "FAT"],
  "evidence": [{ "source_type": "OEM", "publication_id": "1756-RM085" }]
}
```

Every assessment records the pack that produced it. Re-analysis writes a new
row; an earlier assessment is never erased or rewritten.

A test refuses a rule with no positive **and** negative fixture, and refuses a
golden case that asserts nothing.

## Estimating and scope

Hours come from the organization's own effort templates, keyed by **(work
package, unit)**. ControlShift claims no universal engineering-hour values.

A work package with no template is reported **NOT PRICED** and excluded from the
range — never valued at zero. `DISCOVERY` is deliberately template-less: its
size is exactly what is unknown.

Scope is organised into the eleven proposal sections, and every line answers
*why is this in scope?*:

```
unsupported instruction rewrite   2 instruction
  SW-003  2 IIM instances require manual rewrite
  <- RA-2026.08::SW-003 <- STRUCTURED_PARSE; 1756-RM085
```

On GO-001, HMI and Drives read **"nothing scoped here"**. Unevidenced scope
generates discovery, never delivery, and the empty section is printed rather
than omitted: leaving it out would read as an oversight instead of a decision.

## Deliverables

Three documents, rendered from the stored result with the integrator's
branding: an **Engineering Preflight**, a **Proposal Input Package** and a
**Customer Information Request**. Each is written once to `storage/reports/`
with its SHA-256; regenerating creates a new document rather than changing one
that was already sent.

An exclusion nobody approved prints under `Proposed exclusions — NOT APPROVED`,
and the scope above still carries it.

## Traps this project already hit

Each of these was a real defect, found and fixed. They are the reason several
tests exist.

**A work package summed units that were not the same unit.** Two IIM rewrites
plus eleven indirect references became one 13-unit line and priced at 26–78 h
instead of 4–12 h. Packages are now keyed by unit and a test pins the IIM line
at two instructions.

**An extension decided an evidence-bearing type.** `NETWORK_SKETCH.pdf` was
inferred as an electrical drawing; NETWORK coverage went 33% → 0, weighted
coverage 54% → 47%, and BUDGETARY flipped to NOT READY. Nobody typed anything
wrong. Found by running the end-to-end flow through the API instead of the seed.

**The seed wrote rows straight to Postgres.** It walked around seven intake
controls and forced `SCANNED` on files no scanner had seen, so every suite built
on it passed over data no user could produce. The seed now calls the same
services the HTTP layer calls.

**A foreign header silently deleted the program.** Rungs were dropped, the model
came back empty, and no software finding fired — including the two IIM. Rungs
now survive an unreadable header and `PARSE-001` blocks the assessment.

**The golden was not byte-reproducible, and its docstring said it was.**
openpyxl stamps the time into the workbook and into the zip headers, so the
fixture changed on every run. Publishing the repository is what surfaced it.

**CORS refused PATCH.** Validating an assumption and approving an exclusion were
impossible from a browser while every server-side test passed — the suites never
issue a preflight.

**Rungs cannot be rebuilt from the IR.** Branch tokens are structural and are
not stored as instructions, so `BST XIC A NXB XIC B BND` would render as three
contacts in series. Different logic, shown confidently. The IR now keeps each
rung's source line.

## Known limitations

- **The input grammar is half-validated.** The rung layer — `SOR … EOR`,
  `BST/NXB/BND`, the operand spellings — is confirmed against public sources and
  against 143 operands lifted from three real RSLogix projects. **Every header
  keyword is ours**, and the A.B. 6200 record structure is not published;
  Rockwell releases it under NDA. See `docs/slc-ascii-format.md` §1.
- **The rack may not be in the program export at all.** A migration vendor's
  intake takes I/O configuration from a printed report. If that is right, the
  evidence behind most of GO-001's findings moves, and V1 needs a report parser.
  `scripts/validate_export.py` settles it the day a real export arrives.
- **The golden is synthetic.** It hits the specification's counts exactly; it
  does not contain the rarities a twenty-year-old project will.
- **No PDF or photo extraction.** Evidence that exists only inside a drawing is
  reported as missing. That is correct V1 behaviour, not a gap to paper over.
- **Rule predicates are a closed compiled registry**, not an expression DSL. New
  *kinds* of check need an engine release.
- **Analysis is synchronous.** Durable orchestration is not wired; GO-001
  analyses in well under a second, so there is nothing to orchestrate yet.
- **One migration family**: SLC 500 → CompactLogix 5380. No PLC-5, MicroLogix,
  Siemens, Schneider or ABB, and no automatic code conversion.

## Verifying a change

```bash
scripts/verify.sh
```

Engine, golden reproducibility, API against the real database, console
typecheck and production build, the end-to-end product run, and the scanner —
one verdict. It refuses to report green when a suite reports suspiciously few
tests: a run that executed nothing must not look like a run that passed.

On Windows, Smart App Control blocks freshly built Rust **test** binaries; the
script runs them in WSL. See `docs/windows-notes.md`.

## Status

V1 in progress. The engine, the application layer and the console are complete
against the specification's module list and definition of done; GO-001 runs end
to end through the product, scanned by a live ClamAV, in under three seconds.

What it has not done yet is read a **real** customer export. Until one does,
the input grammar stays marked PARTIALLY VALIDATED, and every number downstream
of the parser inherits that caveat.

No semantic versioning, no compatibility promise, no releases.

## License

MIT. See [LICENSE](LICENSE).

The rule packs carry OEM publication numbers as citations, not content: a rule
records that `1756-RM085` is the basis for a finding, it does not reproduce
Rockwell's documentation. The golden dataset is synthetic and owned by this
project.
