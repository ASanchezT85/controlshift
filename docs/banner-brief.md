# Banner brief — ControlShift

Everything an image model needs to design the repository banner. Paste this
whole file into ChatGPT and ask for the banner; the last section is the prompt
to iterate on.

Repository: <https://github.com/ASanchezT85/controlshift>

---

## 1. What the product is

ControlShift is an **industrial migration preflight** tool. A system integrator
is handed an old Allen-Bradley SLC 500 control system — a twenty-year-old PLC
program, drawings from 2014, some phone photos, no HMI backup, no drive
parameters, a twelve-hour shutdown window — and is asked for a **fixed price**.

Before quoting, a senior controls engineer has to reconstruct enough of that
system to understand the risk. ControlShift productises that work: it parses the
program, measures how complete the evidence is, reconstructs what depends on
what, applies versioned migration rules, and produces a verdict:

```
FIXED PRICE          NOT READY
BUDGETARY            READY WITH ALLOWANCES
TIME AND MATERIAL    READY
```

It does **not** convert code, and it never touches a live controller.

## 2. The one idea the banner must carry

**Certainty about what you do not know.**

The product's whole value is that it refuses to guess. Missing evidence stays
UNKNOWN; it never quietly becomes "compatible" or "fine". The banner should feel
like an instrument reading, an inspection stamp, a verdict — *not* like a
marketing hero shot of a factory.

If a viewer takes away one impression, it should be: **this thing tells you what
you cannot see yet, and refuses to pretend otherwise.**

## 3. Audience and tone

Controls engineers and the owners of small system-integration firms. People who
read schematics, distrust marketing, and have been burned by a fixed price on a
job that turned out bigger than the drawings said.

Tone: **technical, sober, precise.** Closer to a calibration certificate or an
engineering drawing title block than to a SaaS landing page. No gradients-and-
glow, no 3D robot arms, no glowing blue "AI" motifs — there is deliberately no
AI anywhere in this product, and implying one would misrepresent it.

## 4. Visual vocabulary from the actual domain

Real elements the design can draw on, all of them true to the product:

- **The chassis.** A ten-slot 1746 rack, slots numbered 0–9, each holding a
  module. In the acceptance case slot 8 holds a `1747-SDN` network scanner —
  the module that turns a parts swap into a project.
- **Ladder logic.** Rungs read left to right between rails, e.g.
  `SOR XIC I:1/0 OTE O:4/0 EOR`. Parallel branches are drawn as two paths
  between the rails.
- **A dependency chain that ends in a question mark:**
  `slot 8 · 1747-SDN → scans → DeviceNet → nodes → UNDETERMINED`
- **Evidence coverage as bars**, some full, some empty:
  `PLC LOGIC 100% · HARDWARE 100% · NETWORK 33% · HMI 0% · DRIVES 0% · SAFETY 0%`
- **A stamp**, the way an engineering document carries one:
  `CANDIDATE — NOT RELEASED FOR PROCUREMENT`.
- **The verdict block** from section 1.

The strongest single image is probably *a complete, confident left side and an
unresolved right side* — reconstruction giving way to explicit unknowns.

## 5. Palette

Taken from the product's own interface. Please use these, not approximations.

| Role | Hex | Where it is used |
|---|---|---|
| Ink / text | `#16191d` | primary text |
| Muted | `#5c6570` | secondary text, edges |
| Surface | `#ffffff` | cards |
| Background | `#f6f7f9` | page |
| Border | `#dfe3e8` | rules and dividers |
| Accent | `#1f4f8b` | the product's blue |
| Blocked | `#a8202b` | a blocking finding |
| Unknown | `#8a5a00` | amber, the colour of "we do not know" |
| Conditional | `#35526f` | conditional mapping |
| Ready | `#1e6b3a` | the only green |

Amber `#8a5a00` and red `#a8202b` should be used sparingly and mean something —
they are the colours of an unknown and a blocker, not decoration.

## 6. Typography

Monospace for anything that represents machine output — addresses, rungs,
verdicts, percentages. A clean grotesque for the wordmark and tagline. No
script, no rounded friendly faces, no letterspaced luxury caps.

The wordmark is one word: **ControlShift**. Set it plainly. If a mark is used,
it should be geometric and readable at 24 px — a slot, a rung, a rail — not an
illustrative icon.

## 7. Text in the image

Required:

> **ControlShift**
> Industrial migration preflight

Optional second line, if the composition has room:

> Know what you're agreeing to deliver before you quote a PLC migration.

Do **not** invent taglines, feature lists, version numbers, company names or
customer logos. `Northstar Foods` and `Northstar Integrators` appear in the
repository but they are **fictional test fixtures** and must not appear as if
they were customers.

## 8. Output specifications

Two assets, please:

1. **README banner** — 1600 × 400 px (4:1), PNG. Sits at the top of the README
   at roughly 900 px wide on a desktop, so nothing smaller than ~18 px at full
   size will be readable.
2. **GitHub social preview** — 1280 × 640 px (2:1), PNG. This is what appears
   when the link is shared. GitHub crops the edges slightly: keep the wordmark
   and any text inside a safe area of about 1100 × 500 centred.

Hard constraints:

- **It must read on both light and dark GitHub themes.** Either give it an
  opaque background from the palette, or produce a light and a dark variant.
  Transparent PNGs with dark text vanish for half the audience.
- No photographs of real equipment, no vendor logos. **Allen-Bradley, Rockwell,
  CompactLogix, DeviceNet and PanelView are third-party trademarks**: catalog
  numbers may appear as text because that is how engineers refer to hardware,
  but no vendor's logo or trade dress may be used.
- Legible at 25% size, because that is how most people will see it.

## 9. Three directions worth trying

**A — The verdict.** Left: the wordmark and tagline. Right: the three-line
readiness block in monospace, `NOT READY` in `#a8202b`, `READY WITH ALLOWANCES`
in `#8a5a00`, `READY` in `#1e6b3a`, set like a stamped result on a document.
Sober, immediately legible, says exactly what the product does.

**B — Reconstruction into uncertainty.** A horizontal band. On the left, ten
numbered slots drawn crisply in accent blue, fully rendered. Moving right, the
drawing degrades: an outline, then a dashed outline, then a single amber node
labelled `UNDETERMINED`. The wordmark sits over the solid left side.

**C — The coverage instrument.** Eight labelled bars — `PLC LOGIC`, `HARDWARE`,
`IO`, `ELECTRICAL`, `NETWORK`, `HMI`, `DRIVES`, `SAFETY` — the first two full in
blue, the last three empty with a thin amber outline. Reads like a gauge panel.
The empty bars are the message.

My preference is **A** for the social preview, where it competes for attention
in a feed, and **B** for the README banner, where there is width to tell a
story. But judge them on what they look like.

## 10. Starting prompt

> Design a GitHub repository banner, 1600×400 px, for a technical developer tool
> called **ControlShift** — an "industrial migration preflight" for
> Allen-Bradley SLC 500 PLC systems. The audience is industrial controls
> engineers; the tone is sober and technical, like an engineering drawing title
> block or a calibration certificate, not a SaaS marketing hero.
>
> Composition: on the left, the wordmark "ControlShift" in a clean grotesque
> with the subtitle "Industrial migration preflight". On the right, a monospace
> verdict block reading `FIXED PRICE — NOT READY`, `BUDGETARY — READY WITH
> ALLOWANCES`, `TIME AND MATERIAL — READY`, set as if stamped on a document.
>
> Palette, exactly: background `#f6f7f9`, text `#16191d`, secondary `#5c6570`,
> accent blue `#1f4f8b`, red `#a8202b` for NOT READY, amber `#8a5a00` for READY
> WITH ALLOWANCES, green `#1e6b3a` for READY. Thin `#dfe3e8` rules.
>
> Flat vector, no gradients, no glow, no 3D, no photographs, no robot arms, no
> vendor logos, no AI motifs. Everything must stay legible at 25% size. Give me
> a light-background version and a dark-background version of the same design.
