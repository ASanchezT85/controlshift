# Banner — corrections for the next pass

The first render is close: palette, verdict block, coverage bars, dependency
chain and the procurement stamp are all right. Three things have to change
before it goes on a public repository, because the audience is controls
engineers and each of these is something they notice in the first second.

Paste this into the same ChatGPT conversation.

---

## 1. Typo in the verdict block — critical

It reads **`BEADY WITH ALLOWANCES`**. It must read **`READY WITH ALLOWANCES`**.

This sits in the single most important element of the image.

## 2. The ladder rung is not valid ladder logic

The drawing shows a contact labelled **`EOR`** inside a parallel branch. `EOR`
is *End Of Rung* — a structural marker in the text export, not an instruction,
and it is never drawn as a contact. `SOR` and `EOR` should not appear in a
ladder diagram at all. An Allen-Bradley programmer reading this would take it
as a sign the tool does not understand ladder.

Replace the whole ladder panel with one of these two, drawn between two
vertical rails:

**Simple rung** (matches the caption `SOR XIC I:1/0 OTE O:4/0 EOR`):

```
 |----[ ]----------------------( )----|
      XIC I:1/0            OTE O:4/0
```

**Parallel branch**, if you want to show branching:

```
 |----[ ]----+----[ ]----+---------( )----|
   XIC I:1/0 |  XIC I:1/1|      OTE O:4/0
             +----[ ]----+
                XIC I:2/8
```

Symbols: a contact is `--] [--` (two short vertical bars), a coil is `--( )--`.
No `SOR`, no `EOR`, no `BST`, no `NXB`, no `BND` anywhere in the drawing — those
are text-format tokens, not graphical elements.

Also delete the two lines of caption under the ladder — *"Rungs read left to
right between rails. Parallel branches are two paths between the rails."* That
was explanatory prose from the brief, not something that belongs in the artwork.

## 3. The rack labels are wrong

Two problems:

- **The power supply is not a numbered slot.** On a 1746-A10 chassis it mounts
  on the left-hand end, outside the ten slots. Slot 0 holds the processor.
- **The processor is not a "1746 CPU".** SLC 500 processors are 1747 parts. The
  one in this system is a **1747-L553**.

Label the rack exactly as the real acceptance case, left to right — an unnumbered
power supply, then slots 0 through 9:

| Position | Catalog | Short label |
|---|---|---|
| PS (unnumbered) | 1746-P2 | `POWER` |
| 0 | **1747-L553** | `CPU` |
| 1 | 1746-IB16 | `IN` |
| 2 | 1746-IB16 | `IN` |
| 3 | 1746-IB16 | `IN` |
| 4 | 1746-OB16 | `OUT` |
| 5 | 1746-OB16 | `OUT` |
| 6 | 1746-NI4 | `AI` |
| 7 | 1746-NO4I | `AO` |
| 8 | **1747-SDN** | `SCANNER` — keep it highlighted in accent blue |
| 9 | 1746-OW16 | `RELAY` |

Keeping slot 8 visually distinct is right and should stay: that module is the
reason the migration is a project rather than a parts swap.

## 4. Smaller notes

- The caption under the rack, `SLOT 8 · 1747-SDN — NETWORK SCANNER`, is correct.
  Keep it.
- `UNDETERMINED` in amber at the end of the dependency chain is exactly right.
- Please also produce the **1600 × 400** README variant. The current image is
  about 2:1, which suits the social preview; the README banner is wider and
  shorter, and the three panels will need rearranging rather than scaling.
- A dark-background variant would be useful, but the opaque light background
  works on both GitHub themes, so this is optional.

## 5. What not to change

The palette, the verdict block layout, the coverage bars with HMI, DRIVES and
SAFETY at 0%, the `CANDIDATE — NOT RELEASED FOR PROCUREMENT` stamp, the
dependency chain ending in a question mark, and the overall sober instrument-
panel feel. Those are all correct and they carry the point of the product.
