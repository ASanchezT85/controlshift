#!/usr/bin/env python3
"""Generate the GO-001 -- PKG-LINE-04 golden opportunity artifacts.

Deterministic: same output every run, no wall clock, no RNG from the stdlib
(own LCG so the bytes never move under a Python upgrade).

Ground truth is MASTER SPEC 57/58/59. The generator asserts the emitted file
actually contains those counts -- if the spec numbers and the emitted text ever
disagree, this script fails instead of quietly shipping a wrong golden.
"""
import csv
import hashlib
import json
import pathlib
import sys

OUT = pathlib.Path(__file__).resolve().parents[1] / "golden" / "opportunities" / "GO-001-PKG-LINE-04"
SRC = OUT / "artifacts"

# ---------------------------------------------------------------- spec 57/59
RACK = [
    (0, "1747-L553"), (1, "1746-IB16"), (2, "1746-IB16"), (3, "1746-IB16"),
    (4, "1746-OB16"), (5, "1746-OB16"), (6, "1746-NI4"), (7, "1746-NO4I"),
    (8, "1747-SDN"), (9, "1746-OW16"),
]
DEVICENET = ["VFD-01", "VFD-02", "Motor Starter 01", "Motor Starter 02",
             "Weigh Scale", "Remote I/O Block"]

N_PROGRAM_FILES = 21
N_RUNGS = 684
N_INSTRUCTIONS = 4231
N_PID, N_MSG, N_INDIRECT, N_STATUS, N_IIM = 3, 8, 11, 39, 2
STI_FILE, STI_INTERVAL_MS = 3, 20

STRUCTURAL = {"SOR", "EOR", "BST", "NXB", "BND"}


class LCG:
    """Numerical Recipes LCG. Deterministic forever, unlike random.Random."""
    def __init__(self, seed): self.s = seed & 0xFFFFFFFF

    def next(self, n):
        self.s = (1664525 * self.s + 1013904223) & 0xFFFFFFFF
        return self.s % n

    def pick(self, seq): return seq[self.next(len(seq))]


# ------------------------------------------------------------------ program
LADDERS = [(2, "MAIN")] + [(STI_FILE, "STI_WEIGH_CONTROL")] + [
    (n, name) for n, name in zip(range(4, 23), [
        "INFEED_CONVEYOR", "ACCUMULATOR", "CARTON_ERECTOR", "PRODUCT_INFEED",
        "FILLER_CONTROL", "CHECKWEIGHER", "REJECT_STATION", "CASE_PACKER",
        "CASE_SEALER", "LABELER", "PALLETIZER", "WRAPPER", "DISCHARGE",
        "SAFETY_INTERLOCKS", "ALARMS", "HMI_INTERFACE", "MSG_HANDLER",
        "RECIPE_MANAGER", "DIAGNOSTICS"])]
assert len(LADDERS) == N_PROGRAM_FILES

# rungs per ladder, deterministic, sums to N_RUNGS (remainder onto DIAGNOSTICS)
_base = [50, 14, 38, 30, 34, 26, 32, 28, 36, 40, 32, 24, 30, 30, 38, 26, 34, 22, 28, 30]
RUNGS_PER = _base + [N_RUNGS - sum(_base)]
assert len(RUNGS_PER) == N_PROGRAM_FILES and sum(RUNGS_PER) == N_RUNGS
assert RUNGS_PER[-1] > 0

DI = [f"I:{s}/{b}" for s in (1, 2, 3) for b in range(16)]
DO = [f"O:{s}/{b}" for s in (4, 5, 9) for b in range(16)]
AI = [f"I:6.{c}" for c in range(4)]
AO = [f"O:7.{c}" for c in range(4)]
INT = [f"N7:{w}" for w in range(40, 200)]
BIT = [f"B3/{b}" for b in range(200)]
TMR = [f"T4:{t}" for t in range(60)]
CTR = [f"C5:{c}" for c in range(40)]

STATUS_OPERANDS = [  # 39 status references, spec 59
    "S:1/15", "S:1/5", "S:2/9", "S:3H", "S:4", "S:5/0", "S:5/2", "S:5/3",
    "S:5/9", "S:6", "S:13", "S:14", "S:24", "S:33/0", "S:33/8", "S:35",
    "S:36", "S:37", "S:38", "S:39", "S:40", "S:41", "S:42", "S:43",
    "S:44", "S:45", "S:46", "S:47", "S:48", "S:49", "S:50", "S:51",
    "S:52", "S:53", "S:54", "S:55", "S:56", "S:57", "S:58",
]
assert len(STATUS_OPERANDS) == N_STATUS

INDIRECT_OPERANDS = [  # 11 indirect references, spec 59
    "N7:[N7:10]", "B3[N7:10]/0", "N7:[N7:11]", "F8:[N7:12]", "N7:[N7:13]",
    "B3[N7:14]/5", "N7:[N7:15]", "T4:[N7:16].ACC", "N7:[N7:17]",
    "N7:[N7:18]", "C5:[N7:19].ACC",
]
assert len(INDIRECT_OPERANDS) == N_INDIRECT


def rung(tokens):
    return "SOR " + " ".join(tokens) + " EOR"


def filler(r):
    """A plain rung: 1-4 input conditions, 1 output."""
    out = []
    for _ in range(1 + r.next(4)):
        op = r.pick(("XIC", "XIO"))
        out.append(f"{op} {r.pick(DI + BIT)}")
    kind = r.next(10)
    if kind < 5:
        out.append(f"{r.pick(('OTE', 'OTL', 'OTU'))} {r.pick(DO + BIT)}")
    elif kind < 7:
        out.append(f"TON {r.pick(TMR)} 1.0 {10 + r.next(600)} 0")
    elif kind < 8:
        out.append(f"CTU {r.pick(CTR)} {100 + r.next(900)} 0")
    elif kind < 9:
        out.append(f"MOV {r.pick(INT)} {r.pick(INT)}")
    else:
        out.append(f"ADD {r.pick(INT)} {1 + r.next(99)} {r.pick(INT)}")
    return out


def build_ladders():
    r = LCG(0xC0FFEE)
    special = {}  # (ladder_idx, rung_idx) -> tokens

    def place(li, ri, tokens):
        """Take the first free rung at or after `ri`; never silently overwrite."""
        while (li, ri) in special:
            ri += 1
        if ri >= RUNGS_PER[li]:
            sys.exit(f"ladder {LADDERS[li]} has no free rung near {ri}")
        special[(li, ri)] = tokens

    # 3 PID -- filler(5)=FILLER_CONTROL, CHECKWEIGHER(6), STI(1)
    place(5, 4, [f"PID PD9:0 {AI[0]} {AO[0]} 0"])
    place(6, 4, [f"PID PD9:1 {AI[1]} {AO[1]} 0"])
    place(1, 3, [f"PID PD9:2 {AI[2]} {AO[2]} 0"])
    # 8 MSG -- MSG_HANDLER(18) mostly
    for i in range(6):
        place(18, 2 + i * 3, [f"XIC B3/{100 + i}", f"MSG MG10:{i}"])
    place(16, 5, ["XIC B3/106", "MSG MG10:6"])
    place(19, 4, ["XIC B3/107", "MSG MG10:7"])
    # 2 IIM -- immediate input for the checkweigher gate + safety scan
    place(6, 9, [f"IIM I:2.0 1"])
    place(15, 3, [f"IIM I:3.0 1"])
    # 11 indirect operands -- RECIPE_MANAGER(19) and DIAGNOSTICS(20)
    for i, opnd in enumerate(INDIRECT_OPERANDS):
        li, ri = (19, 8 + i * 2) if i < 6 else (20, 3 + (i - 6) * 3)
        instr = f"XIC {opnd}" if "/" in opnd.split("]")[-1] else f"MOV {opnd} N7:250"
        place(li, ri, [instr])
    # 39 status operands -- DIAGNOSTICS(20) and ALARMS(16)
    for i, opnd in enumerate(STATUS_OPERANDS):
        li, ri = (20, 20 + i) if i < 20 else (16, 1 + (i - 20))
        instr = f"XIC {opnd}" if "/" in opnd else f"MOV {opnd} N7:{260 + i}"
        place(li, ri, [instr])

    ladders = []
    for li, ((num, name), count) in enumerate(zip(LADDERS, RUNGS_PER)):
        rungs = []
        for ri in range(count):
            if (li, ri) in special:
                rungs.append(list(special[(li, ri)]))
            elif ri and ri % 17 == 0:  # occasional branch, structural tokens
                a, b = r.pick(DI), r.pick(DI)
                rungs.append(["BST", f"XIC {a}", "NXB", f"XIC {b}", "BND",
                              f"OTE {r.pick(DO)}"])
            else:
                rungs.append(filler(r))
        ladders.append((num, name, rungs))
    return ladders


def count_instructions(ladders):
    return sum(len([t for t in rg if t.split()[0] not in STRUCTURAL])
               for _, _, rgs in ladders for rg in rgs)


def pad_to_target(ladders):
    """Trim/extend the tail ladder's rungs until instruction count is exact."""
    delta = N_INSTRUCTIONS - count_instructions(ladders)
    _, _, rungs = ladders[-1]
    i = 0
    while delta > 0:
        rungs[i % len(rungs)].insert(0, f"XIC B3/{190 + (i % 10)}")
        delta -= 1
        i += 1
    while delta < 0:
        rg = rungs[i % len(rungs)]
        if len(rg) > 1 and rg[0].split()[0] in ("XIC", "XIO"):
            rg.pop(0)
            delta += 1
        i += 1
        if i > 100000:
            sys.exit("cannot converge on instruction target")
    return ladders


def emit_slc(ladders):
    L = ["IE Rev 1.0",
         'PROJECT "PKG-LINE-04"',
         "PROCESSOR 1747-L553", "PROCESSOR_OS OS501", "PROCESSOR_SERIES C",
         "CHASSIS 1746-A10"]
    L += [f"SLOT {s} {c}" for s, c in RACK]
    L += ["END_IO", ""]
    L += ["DATAFILE O0 OUTPUT 10", "DATAFILE I1 INPUT 10",
          "DATAFILE S2 STATUS 96", "DATAFILE B3 BINARY 256",
          "DATAFILE T4 TIMER 60", "DATAFILE C5 COUNTER 40",
          "DATAFILE R6 CONTROL 20", "DATAFILE N7 INTEGER 400",
          "DATAFILE F8 FLOAT 100", "DATAFILE PD9 PID 8",
          "DATAFILE MG10 MESSAGE 12", "END_DATAFILES", ""]
    L += [f"STI_FILE {STI_FILE} {STI_INTERVAL_MS}", ""]
    for num, name, rungs in ladders:
        L.append(f'LADDER {num} "{name}"')
        L += [rung(t) for t in rungs]
        L += ["END_LADDER", ""]
    return "\n".join(L) + "\n"


SYMBOLS = [
    ("I:1/0", "INFEED_PE", "Infeed photoeye"),
    ("I:1/1", "ESTOP_OK", "E-stop string healthy"),
    ("I:1/2", "GUARD_DOOR_1", "Guard door 1 closed"),
    ("I:2/0", "CHKWGH_TRIG", "Checkweigher trigger"),
    ("I:3/0", "SAFETY_RESET", "Safety reset pushbutton"),
    ("O:4/0", "INFEED_RUN", "Infeed conveyor run"),
    ("O:4/1", "FILLER_RUN", "Filler drive run"),
    ("O:5/0", "REJECT_SOL", "Reject pusher solenoid"),
    ("O:9/0", "MAIN_AIR_VLV", "Main air valve"),
    ("I:6.0", "FILL_WEIGHT_AI", "Fill weight analog in"),
    ("I:6.1", "LINE_PRESSURE", "Line pressure transmitter"),
    ("I:6.2", "SCALE_RATE", "Weigh scale rate"),
    ("O:7.0", "FILLER_SPEED_AO", "Filler speed reference"),
    ("O:7.1", "CONV_SPEED_AO", "Conveyor speed reference"),
    ("N7:10", "RECIPE_PTR", "Active recipe index (indirect)"),
    ("N7:20", "CASE_COUNT", "Cases produced this shift"),
    ("B3/0", "LINE_RUNNING", "Line running latch"),
    ("B3/100", "MSG_TRIG_0", "MSG trigger - VFD01 status read"),
    ("T4:0", "INFEED_DLY", "Infeed start delay"),
    ("C5:0", "CASE_CTR", "Case counter"),
    ("PD9:0", "FILL_PID", "Fill weight PID"),
    ("PD9:1", "CHKWGH_PID", "Checkweigher trim PID"),
    ("PD9:2", "SCALE_PID", "Weigh scale STI PID"),
    ("MG10:0", "MSG_VFD01", "Read VFD-01 status over DeviceNet"),
]

IO_LIST = [
    (1, "1746-IB16", 16, "I:1/0-15", "24VDC sinking inputs, infeed + safety"),
    (2, "1746-IB16", 16, "I:2/0-15", "24VDC sinking inputs, filler zone"),
    (3, "1746-IB16", 16, "I:3/0-15", "24VDC sinking inputs, discharge zone"),
    (4, "1746-OB16", 16, "O:4/0-15", "24VDC sourcing outputs, conveyors"),
    (5, "1746-OB16", 16, "O:5/0-15", "24VDC sourcing outputs, reject/pack"),
    (6, "1746-NI4", 4, "I:6.0-3", "Analog in 4-20mA, weight/pressure"),
    (7, "1746-NO4I", 4, "O:7.0-3", "Analog out 4-20mA isolated, speed refs"),
    (9, "1746-OW16", 16, "O:9/0-15", "Relay outputs, valves + legacy starters"),
]

NOTES = """PKG-LINE-04 -- Northstar Foods, Plant 03 Packaging
Customer notes, transcribed from the walkdown call.

- SLC 5/03 has been in since the line was installed. Two spare 1746-IB16 on the
  shelf, nothing else.
- Maximum shutdown we can give you is 12 hours, over a Sunday. Line has to run
  Monday 6am.
- We want a fixed price.
- HMI is a PanelView running something old. Nobody here has the project file.
  The guy who did it left in 2019.
- The two VFDs on DeviceNet were replaced at some point, we do not know the
  parameters. No backups.
- Electrical drawings are Rev C, printed 2014. There have been changes on the
  floor since -- at least the reject station was rebuilt.
- There is a light curtain at the infeed and a safety relay in the panel. Not
  sure if the PLC is involved in the safety at all.
- DeviceNet: we know there are drives, starters and the scale on it. No node
  list, no configuration backup.
"""


def minimal_pdf(path, title, lines):
    """Smallest valid PDF that opens: one page, Helvetica, no dependencies."""
    body = "BT /F1 11 Tf 50 760 Td 14 TL\n"
    body += "".join(f"({l.replace('(', '').replace(')', '')}) Tj T*\n"
                    for l in [title, ""] + lines)
    body += "ET"
    objs = ["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
            f"<< /Length {len(body)} >>\nstream\n{body}\nendstream",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = "%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{o}\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n"
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets)
    out += (f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref}\n%%EOF\n")
    path.write_bytes(out.encode("latin-1"))


def main():
    SRC.mkdir(parents=True, exist_ok=True)
    (SRC / "photos").mkdir(exist_ok=True)

    ladders = pad_to_target(build_ladders())
    text = emit_slc(ladders)

    # ---- verify the emitted text against the spec, not against our intent
    tokens = [ln[4:-4].split() for ln in text.splitlines() if ln.startswith("SOR ")]
    instr = [t for rg in tokens for t in rg]
    mnem = [t for i, t in enumerate(instr) if t.isupper() and t.isalpha()
            and t not in STRUCTURAL and (i == 0 or _is_mnemonic_pos(instr, i))]
    checks = {
        "program_files": (len(ladders), N_PROGRAM_FILES),
        "rungs": (len(tokens), N_RUNGS),
        "instructions": (count_instructions(ladders), N_INSTRUCTIONS),
        "pid": (text.count("PID PD9:"), N_PID),
        "msg": (text.count("MSG MG10:"), N_MSG),
        "iim": (text.count("IIM "), N_IIM),
        "indirect": (sum(t.count("[") for t in instr), N_INDIRECT),
        "status": (sum(1 for t in instr if t.startswith("S:")), N_STATUS),
        "sti_interval": (STI_INTERVAL_MS, 20),
    }
    bad = {k: v for k, v in checks.items() if v[0] != v[1]}
    if bad:
        sys.exit(f"golden does not match MASTER SPEC 59: {bad}")

    (SRC / "PKG04.SLC").write_text(text, encoding="ascii")

    with open(SRC / "PKG04_SYMBOLS.CSV", "w", newline="", encoding="ascii") as f:
        w = csv.writer(f)
        w.writerow(["ADDRESS", "SYMBOL", "DESCRIPTION"])
        w.writerows(SYMBOLS)

    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "IO List"
    ws.append(["Slot", "Catalog", "Points", "Address Range", "Description"])
    for row in IO_LIST:
        ws.append(list(row))
    wb.save(SRC / "PKG04_IO_LIST.xlsx")

    minimal_pdf(SRC / "ELECTRICAL_REV_C.pdf",
                "PKG-LINE-04 ELECTRICAL - REV C - 2014-06-11", [
                    "SHEET 1  PANEL LAYOUT",
                    "SHEET 2  SLC 500 CHASSIS 1746-A10, SLOTS 0-9",
                    "SHEET 3  24VDC DISTRIBUTION",
                    "SHEET 4  INFEED / ACCUMULATOR I/O",
                    "SHEET 5  FILLER I/O",
                    "SHEET 6  REJECT STATION I/O   [SUPERSEDED ON FLOOR]",
                    "SHEET 7  ANALOG I/O",
                    "",
                    "NOTE: REV C DOES NOT REFLECT 2019 REJECT STATION REBUILD.",
                    "NOTE: SAFETY CIRCUIT SHOWN ON SHEET 3 ONLY, RELAY DETAIL MISSING.",
                ])
    minimal_pdf(SRC / "NETWORK_SKETCH.pdf",
                "PKG-LINE-04 NETWORK SKETCH - HAND MARKUP - UNDATED", [
                    "SLC 5/03 CH0 -> DH-485 -> PANELVIEW (MODEL UNKNOWN)",
                    "1747-SDN SLOT 8 -> DEVICENET TRUNK",
                    "   - VFD-01     (NODE ?)",
                    "   - VFD-02     (NODE ?)",
                    "   - STARTER 01 (NODE ?)",
                    "   - STARTER 02 (NODE ?)",
                    "   - SCALE      (NODE ?)",
                    "   - REMOTE I/O (NODE ?)",
                    "",
                    "NODE ADDRESSES AND BAUD RATE NOT RECORDED.",
                    "NO DEVICENET CONFIGURATION BACKUP AVAILABLE.",
                ])
    (SRC / "customer_notes.txt").write_text(NOTES, encoding="ascii")
    for n, cap in [("01_panel_interior.txt", "SLC 500 chassis, 10 slots, door open"),
                   ("02_slot8_sdn.txt", "1747-SDN module, status LEDs, node display unreadable"),
                   ("03_panelview.txt", "PanelView on the operator station, model plate glared out"),
                   ("04_vfd01.txt", "VFD-01 in the drive cabinet, nameplate partially obscured")]:
        (SRC / "photos" / n).write_text(
            f"[photo placeholder] {cap}\n", encoding="ascii")

    def artifact_type(rel):
        n = rel.lower()
        if n.startswith("photos/"): return "PHOTO"
        if n.endswith(".slc"): return "PLC_SOURCE"
        if "symbols" in n: return "SYMBOL_DATABASE"
        if "io_list" in n: return "IO_LIST"
        if n.startswith("electrical"): return "ELECTRICAL_DRAWING"
        if n.startswith("network"): return "NETWORK_DRAWING"
        if n.endswith("notes.txt"): return "CUSTOMER_NOTE"
        return "OTHER"

    manifest = []
    for p in sorted(SRC.rglob("*")):
        if p.is_file():
            rel = p.relative_to(SRC).as_posix()
            manifest.append({
                "path": rel,
                "artifact_type": artifact_type(rel),
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
                "size": p.stat().st_size,
            })
    (OUT / "manifest.json").write_text(
        json.dumps({"opportunity": "GO-001-PKG-LINE-04", "artifacts": manifest},
                   indent=2) + "\n", encoding="ascii")

    print(f"golden written to {OUT}")
    for k, (got, want) in checks.items():
        print(f"  {k:<16} {got}  (spec {want})")


def _is_mnemonic_pos(instr, i):
    return True  # kept simple: counts come from count_instructions()


if __name__ == "__main__":
    main()
