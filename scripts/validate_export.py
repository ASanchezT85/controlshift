#!/usr/bin/env python3
"""One command to run the moment a real RSLogix export lands.

    python scripts/validate_export.py path/to/EXPORT.SLC

Answers the three questions that keep docs/slc-ascii-format.md marked
PARTIALLY VALIDATED:

  1. Does the assumed grammar read the file?          (conform.py)
  2. Does the engine reconstruct a system from it?    (csanalyze)
  3. Is the rack and slot list inside the export,     (the §1.3 question)
     or only in the printed report?

Prints a verdict and, when the grammar does not hold, the evidence needed to
revise it. Changes nothing.
"""
import json
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import conform  # noqa: E402

# 1746 I/O modules and 1747 processors/scanners: if the rack is in the export,
# these catalog numbers are in the text.
CATALOG = re.compile(r"\b17(?:46|47)-[A-Z0-9]{2,10}\b")


def engine_binary() -> pathlib.Path | None:
    for profile in ("release", "debug"):
        for name in ("csanalyze.exe", "csanalyze"):
            p = ROOT / "target" / profile / name
            if p.is_file():
                return p
    return None


def run_engine(export: pathlib.Path):
    exe = engine_binary()
    if exe is None:
        return None, "no engine binary; run `cargo build --release` first"
    with tempfile.TemporaryDirectory() as tmp:
        request = pathlib.Path(tmp) / "request.json"
        request.write_text(
            json.dumps(
                {
                    "schema_version": "1.0.0",
                    "opportunity_id": "VALIDATE-EXPORT",
                    "rule_pack": "RA-2026.08",
                    "artifacts": [
                        {"path": str(export.resolve()), "artifact_type": "PLC_SOURCE"}
                    ],
                }
            )
        )
        proc = subprocess.run(
            [str(exe), "--request", str(request), "--rulepacks", str(ROOT / "rulepacks" / "rockwell")],
            capture_output=True,
            text=True,
        )
    if proc.returncode != 0:
        return None, proc.stderr.strip()[:400]
    try:
        return json.loads(proc.stdout), None
    except json.JSONDecodeError as e:
        return None, f"engine output was not JSON: {e}"


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    export = pathlib.Path(sys.argv[1])
    if not export.is_file():
        sys.exit(f"{export}: not a file")

    print("=" * 68)
    print(" 1. GRAMMAR - does docs/slc-ascii-format.md section 2 read this file?")
    print("=" * 68)
    conform.report(export)

    print()
    print("=" * 68)
    print(" 2. ENGINE - what system does it reconstruct?")
    print("=" * 68)
    result, error = run_engine(export)
    if error:
        print(f"  engine refused: {error}")
    else:
        s = result["system_model"]
        rungs = sum(len(p["rungs"]) for p in s["programs"])
        instrs = sum(len(g["instructions"]) for p in s["programs"] for g in p["rungs"])
        print(f"  processor    {s['processor'] or '(none found)'}")
        print(f"  chassis      {s['chassis'] or '(none found)'}")
        print(f"  modules      {len(s['modules'])}")
        print(f"  programs     {len(s['programs'])}, {rungs} rungs, {instrs} instructions")
        print(f"  diagnostics  {len(result['diagnostics'])}")
        for d in result["diagnostics"][:8]:
            print(f"    {d['severity']:<7} {d['code']:<26} line {d['line']}")
        ids = [f["id"] for f in result["findings"]]
        print(f"  findings     {', '.join(ids) if ids else '(none)'}")
        if "PARSE-001" in ids:
            print("  >> PARSE-001 fired: the engine does not believe it understood this file.")

    print()
    print("=" * 68)
    print(" 3. THE RACK QUESTION - docs/slc-ascii-format.md section 1.3")
    print("=" * 68)
    try:
        text = export.read_text(encoding="ascii")
    except (UnicodeDecodeError, ValueError):
        text = export.read_bytes().decode("cp1252", errors="replace")
    catalogs = sorted(set(CATALOG.findall(text)))
    if catalogs:
        print(f"  Catalog numbers present in the export: {', '.join(catalogs[:12])}")
        print("  >> The rack IS in the program export. Section 1.3 resolves in our favour:")
        print("     no PROCESSOR_REPORT artifact type is needed.")
    else:
        print("  No 1746-/1747- catalog number appears anywhere in this file.")
        print("  >> The rack is NOT in the program export. Section 1.3 resolves against us:")
        print("     the I/O evidence behind IO-001..005, NET-001 and LIFE-001 has to")
        print("     come from the Printer.txt report, and V1 needs a parser for it.")
        print("     This is a specification revision, not a bug fix.")

    print()
    print("Next: update docs/slc-ascii-format.md section 1 with what this run showed,")
    print("and lift the PARTIALLY VALIDATED marker only if sections 1 and 3 both hold.")


if __name__ == "__main__":
    main()
