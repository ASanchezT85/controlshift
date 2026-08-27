# Requesting an SLC 500 export from a customer

What to ask for, in the customer's words, and why each file matters. Sourced
from the RSLogix 500 export procedure documented by Honeywell's ControlEdge
Transition intake and from the RSLogix ladder-export community record — see
`docs/slc-ascii-format.md` §1 for the citations.

## The three files

Ask for all three. Two of them are one dialog apart, and the third is a print.

### 1. The program export — `.SLC`

```
RSLogix 500 → File → Save As
  → tick "Export Database"
  → tick "A.B. 6200"
  → file type: .SLC
  → tick "Complete Program Save"
  → enable all Export Options
```

Contains the rungs and instructions. Without it there is no system model and
no software finding: ControlShift will report `PARSE-001 BLOCKED` rather than
an empty assessment.

### 2. The symbol database — `.SYS6`

Produced by the same Save As. Carries the symbol comments for the variables.
Without it the program parses but reads as bare addresses, and
`PLC_LOGIC` coverage drops.

### 3. The report print-out — `Printer.txt`

```
Set up a text printer pointed at C:\temp\Printer.txt
RSLogix 500 → File → Report Options
  → Select All → Apply → Print
  → choose the Text Printer
```

Carries the processor and "extensions" information. **We currently assume the
rack and slot list is inside the `.SLC`; it may only be here.** Ask for it on
every engagement until that question is settled — it is the evidence behind the
I/O mapping, the DeviceNet and the lifecycle findings.

## What NOT to accept as a substitute

- **`Tools → Database → ASCII Export`** exports the tag database *only*. A
  customer who sends "the ASCII export" may have sent symbols and no logic.
- **The `.RSS` project file.** It is the native binary and V1 does not read it.
  ControlShift analyzes copies of offline artifacts, never the controller.
- **A screenshot or PDF of the ladder.** V1 does not extract from drawings.

## Everything else worth asking for in the same email

None of these are parsed by V1, but each one closes an evidence domain that
otherwise reports 0% and blocks fixed-price readiness:

- HMI application (PanelView project upload, or the terminal's own backup)
- VFD parameter backups, one per drive
- DeviceNet configuration backup (RSNetWorx) **and** the node address list
- As-built electrical drawings, or confirmation that the latest revision is
  what is in the panel
- The safety architecture: devices, circuits, whether the PLC is involved
- The maximum shutdown window, in hours, and when it can be taken

## Before analysing anything

Run the conformance harness on the file the customer sends:

```bash
python scripts/conform.py path/to/CUSTOMER.SLC
```

If it reports lines outside the assumed grammar, revise
`docs/slc-ascii-format.md` §2 **before** trusting any finding derived from that
file. The parser keeps rungs it can read even under an unfamiliar header, but a
grammar mismatch is a product question, not a parser bug to route around.
