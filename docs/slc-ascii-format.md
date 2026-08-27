# SLC ASCII Export — Input Grammar (V1)

**Status:** assumed grammar. Modeled on the RSLogix 500 / APS ASCII export
conventions (the `SOR … EOR` rung syntax and `BST/NXB/BND` branch tokens are
the real RSLogix ladder-export spelling). Verify against a real customer export
before the first pilot; the lexer is written against *this* document, so any
divergence is a spec change here first.

The binary `.SLC`/`.RSS` project file is **not** an accepted V1 input
(§18 requires a deterministic lexer+parser; the binary format has no public
specification). ControlShift consumes the ASCII export.

## File shape

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
SOR <instruction>... EOR
END_LADDER
...
```

- Lines are trimmed; blank lines and lines starting with `;` are comments.
- Rung numbers are implicit, zero-based, in file order.
- One rung per line. A rung always opens with `SOR` and closes with `EOR`.

## Instructions

`<MNEMONIC> [operand ...]` — operands are whitespace separated.

Counting rule (**load-bearing for the golden totals**): `SOR`, `EOR`, `BST`,
`NXB` and `BND` are *structural tokens*, not instructions. They are not
included in `instruction_count`. Everything else between `SOR` and `EOR` is one
instruction.

## Operands

| Form | Meaning |
|---|---|
| `I:1/0` | discrete input, slot 1, bit 0 |
| `O:4/0` | discrete output |
| `I:6.0` | analog input word, slot 6, channel 0 |
| `N7:20` | integer file word |
| `N7:20/3` | bit of an integer word |
| `S:5/0` | status file reference |
| `B3[N7:10]/0` | **indirect** — bracketed operand supplies the element index |
| `T4:0/DN` | structured-element member access |
| `#N7:0` | file/array operand (e.g. COP, FLL) |
| `12` / `1.5` | immediate |

An operand is *indirect* iff it contains `[`. An operand is a *status
reference* iff its file designator is `S`.

## Diagnostics

Malformed input must never crash the parser (§72). Every unparsable line
produces a diagnostic carrying file, line, column and the offending token, and
parsing continues with the next line.
