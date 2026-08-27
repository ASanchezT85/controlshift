#!/usr/bin/env python3
"""Conformance harness: how much of a REAL export does our parser understand?

    python scripts/conform.py <export-file> [more files...]

Run this the day a real RSLogix 500 export arrives. It classifies every line of
the file against the grammar in docs/slc-ascii-format.md and prints what we
read, what we guessed at, and what we could not read at all.

It deliberately does NOT try to be clever about unknown lines. The output is
evidence for revising the grammar, not a parser.
"""
import collections
import pathlib
import re
import sys

HEADER_KEYWORDS = {
    "IE", "PROJECT", "PROCESSOR", "PROCESSOR_OS", "PROCESSOR_SERIES", "CHASSIS",
    "SLOT", "END_IO", "DATAFILE", "END_DATAFILES", "STI_FILE", "LADDER",
    "END_LADDER",
}
STRUCTURAL = {"SOR", "EOR", "BST", "NXB", "BND"}

# Mnemonic shape our parser accepts: 1-4 chars, upper/digit, starts upper.
MNEMONIC = re.compile(r"^[A-Z][A-Z0-9]{0,3}$")

# Operand shapes documented in docs/slc-ascii-format.md.
OPERAND = re.compile(
    r"""^(
        \#?[A-Z]+\d*:\[?[A-Z]*\d*:?\d*\]?[./][A-Z0-9]+   # N7:20/3, T4:0/DN, I:6.0
      | [A-Z]+\d*:\d+[HL]                                 # S:3H, S:3L (byte of a word)
      | \#?[A-Z]+\d*:\[?[A-Z]*\d*:?\d*\]?                # N7:20, N7:[N7:10]
      | [A-Z]+\d*\[[A-Z]+\d*:\d+\](/\d+)?                # B3[N7:10]/0
      | [A-Z]+\d*/\d+                                    # B3/0
      | -?\d+(\.\d+)?                                    # immediates
    )$""",
    re.VERBOSE,
)


def classify(line: str):
    """Return (bucket, detail) for one line."""
    text = line.split(";", 1)[0].strip()
    if not text:
        return "blank_or_comment", ""
    tokens = text.replace('"', " ").split()
    head = tokens[0]

    if head == "SOR":
        unknown = []
        for t in tokens[1:]:
            if t in STRUCTURAL or MNEMONIC.match(t) or OPERAND.match(t):
                continue
            unknown.append(t)
        if "EOR" not in tokens:
            return "rung_unterminated", text[:70]
        return ("rung_ok", "") if not unknown else ("rung_unknown_token", " ".join(unknown[:4]))

    if head in HEADER_KEYWORDS:
        return "header_ok", head
    return "unreadable", head


def report(path: pathlib.Path):
    try:
        raw = path.read_bytes()
    except OSError as e:
        print(f"{path}: {e}")
        return
    try:
        text = raw.decode("ascii")
        encoding = "ascii"
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="replace")
        encoding = "cp1252 (NOT ascii - the grammar assumes ascii)"

    lines = text.splitlines()
    buckets = collections.Counter()
    samples = collections.defaultdict(list)
    for n, line in enumerate(lines, 1):
        bucket, detail = classify(line)
        buckets[bucket] += 1
        if bucket in ("unreadable", "rung_unknown_token", "rung_unterminated") and len(
            samples[bucket]
        ) < 12:
            samples[bucket].append(f"  line {n}: {detail}")

    meaningful = sum(v for k, v in buckets.items() if k != "blank_or_comment")
    understood = buckets["rung_ok"] + buckets["header_ok"]
    pct = (understood / meaningful * 100) if meaningful else 0.0

    print(f"\n=== {path.name} ===")
    print(f"encoding           {encoding}")
    print(f"lines              {len(lines)} ({meaningful} meaningful)")
    print(f"understood         {understood}  ({pct:.1f}%)")
    for bucket in (
        "header_ok",
        "rung_ok",
        "rung_unknown_token",
        "rung_unterminated",
        "unreadable",
        "blank_or_comment",
    ):
        if buckets[bucket]:
            print(f"  {bucket:<20} {buckets[bucket]}")
    for bucket, rows in samples.items():
        if rows:
            print(f"\n{bucket} samples:")
            print("\n".join(rows))

    if buckets["unreadable"]:
        print(
            f"\nVERDICT: {buckets['unreadable']} line(s) are outside the assumed grammar.\n"
            "         docs/slc-ascii-format.md section 2 needs revising against this file."
        )
    elif pct >= 99:
        print("\nVERDICT: the assumed grammar holds for this file.")
    else:
        print("\nVERDICT: rungs parse but some tokens are unrecognised; see samples above.")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for arg in sys.argv[1:]:
        report(pathlib.Path(arg))


if __name__ == "__main__":
    main()
