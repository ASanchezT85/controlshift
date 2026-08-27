# SLC ASCII Export — Input Grammar (V1)

**Status: PARTIALLY VALIDATED.** Validated against public sources on 2026-08-27,
not against a real customer export. Read §1 before trusting anything downstream
of this parser.

## 1. What is confirmed, what is not

### Confirmed by public sources

The rung layer. `SOR … EOR` one rung per line, with `BST` / `NXB` / `BND`
branch tokens and mnemonic-plus-operand instructions, is the real RSLogix
ladder-export spelling. A published example reads:

> `SOR BST XIC I:0/0 NXB XIC O:10/0 BND XIO I:5/0 XIO I:20/0 OTE O:10/0 EOR`
> — [Industrial Monitor Direct, RSLogix ladder export][imd-export]

Our lexer and rung parser accept that line unchanged.

### Confirmed, and it corrects an earlier assumption

The `.SLC` file is the **A.B. 6200 ASCII export**, produced by
`File > Save As > Export Database (A.B. 6200 checkbox) > .SLC`, with *Complete
Program Save* and all export options enabled. It "contains all the program
information including rungs and instruction". Two companions come out of the
same procedure and matter to us:

| File | Contains | Our artifact type |
|---|---|---|
| `.SLC` | program: rungs and instructions | `PLC_SOURCE` |
| `.SYS6` | symbol comments for the variables | `SYMBOL_DATABASE` |
| `Printer.txt` | report print-out, "all the extensions information" | not yet modelled |

— [Honeywell ControlEdge Transition, extracting source PLC files][honeywell]

Note also that `Tools > Database > ASCII Export` inside RSLogix 500 exports the
**tag database only**, never the ladder ([Industrial Monitor Direct][imd-export]).
If a customer sends "the ASCII export" they may well send symbols and no logic.

### NOT confirmed — treat as invented until a real file arrives

1. **Every header keyword in §2.** `PROJECT`, `PROCESSOR`, `PROCESSOR_OS`,
   `PROCESSOR_SERIES`, `CHASSIS`, `SLOT`, `DATAFILE`, `STI_FILE`,
   `LADDER n "NAME"`, `END_LADDER`, `END_IO`, `END_DATAFILES` are **ours**. The
   real 6200 record structure is not published: Rockwell distributes it under
   NDA through their Developer Network
   ([Industrial Monitor Direct, format specs][imd-formats]).
2. **That the rack and slot list is in the `.SLC` at all.** Honeywell's
   migration tool takes I/O and "extensions" information from the printed
   `Printer.txt` report, and its SLC 500 instructions name no I/O configuration
   file. If that is right, `IO-001`…`IO-005`, `NET-001` and `LIFE-001` — most of
   GO-001's findings — draw their evidence from a **report print-out**, not from
   the program export, and V1 needs a `PROCESSOR_REPORT` artifact type with its
   own parser. **This is the open question that a real export settles.**
3. **One file per project.** Our grammar assumes a single file carries the whole
   program. A per-program-file library export (`Export → Export to Library`) is
   also real and produces one file per routine.

## 2. The grammar as implemented

```
IE Rev 1.0
PROJECT "<name>"
PROCESSOR <catalog>
PROCESSOR_OS <os>
PROCESSOR_SERIES <letter>
CHASSIS <catalog>
SLOT <n> <catalog>
...
END_IO

DATAFILE <file> <type> <size>
...
END_DATAFILES

STI_FILE <program_file_number> <interval_ms>

LADDER <n> "<NAME>"
SOR <instruction>... EOR
END_LADDER
...
```

- Lines are trimmed; blank lines and `;` comments are dropped.
- Rung numbers are implicit, zero-based, in file order.

### Instructions

`<MNEMONIC> [operand ...]`, whitespace separated.

Counting rule (**load-bearing for the golden totals**): `SOR`, `EOR`, `BST`,
`NXB` and `BND` are structural tokens, not instructions, and are excluded from
`instruction_count`.

### Operands

| Form | Meaning |
|---|---|
| `I:1/0` | discrete input, slot 1, bit 0 |
| `O:4/0` | discrete output |
| `I:6.0` | analog input word, slot 6, channel 0 |
| `N7:20`, `N7:20/3` | integer word, bit of a word |
| `S:5/0` | status file reference |
| `B3[N7:10]/0` | **indirect** — bracketed operand supplies the element index |
| `T4:0/DN` | structured-element member |
| `#N7:0` | file/array operand |
| `12`, `1.5` | immediate |

An operand is *indirect* iff it contains `[`; a *status reference* iff its file
designator is `S`.

## 3. How the parser behaves when this grammar is wrong

This is the part that matters, because §1 says the header probably **is** wrong.

- **A rung outside any recognised block is kept**, attached to a synthetic
  `UNATTRIBUTED` program, with a `W_RUNG_OUTSIDE_LADDER` warning. The rung layer
  is the confirmed part of the format; an unreadable container costs us the
  container, never the logic. Fixture: `golden/atomic/G1-017`.
- **An unreadable source cannot present as a clean bill of health.** Rule
  `PARSE-001` fires `BLOCKED` when a supplied `PLC_SOURCE` yields zero rungs, or
  when parser errors exceed 10% of reconstructed rungs. Without it, a header we
  cannot read produces an empty model, no software findings, and an assessment
  that reads as "nothing wrong" — the exact false-safe of SPEC 63.
- Malformed input never crashes the parser (SPEC 72); every rejected line
  carries file, line, column and the offending token.

## 4. Validating against a real export

`scripts/conform.py <export-file>` reports what fraction of the file the parser
understands, line by line, and lists every construct it rejects. Run it the day
the first real export arrives; the output is the input to revising §2.

`docs/customer-intake.md` has the exact menu steps to request one.

[imd-export]: https://industrialmonitordirect.com/pt/blogs/knowledgebase/exporting-rslogix-ladder-logic-to-text-rslogix-500-and-5000
[honeywell]: https://www.migrationapps.honeywell.com/Help/Content/Extracting_Source_PLC_System_Files.htm
[imd-formats]: https://industrialmonitordirect.com/fr/blogs/knowledgebase/allen-bradley-pc5-slc-ab-6200-ab-aps-file-format-specifications
