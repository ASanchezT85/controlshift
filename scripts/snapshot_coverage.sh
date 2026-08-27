#!/usr/bin/env bash
# Regenerate the GO-001 coverage snapshot after an intentional coverage change.
set -euo pipefail
cd "$(dirname "$0")/.."
d=golden/opportunities/GO-001-PKG-LINE-04
cargo run -q -- --request $d/request.json --out "$d/.result.json"
python - "$d" <<'PY'
import json,sys,pathlib
d=pathlib.Path(sys.argv[1]); r=json.loads((d/".result.json").read_text())
snap=json.loads((d/"coverage.snapshot.json").read_text())
snap["rule_pack"]=r["versions"]["rule_pack_version"]
snap["domains"]={c["domain"]:c["percent"] for c in r["evidence_coverage"]}
(d/"coverage.snapshot.json").write_text(json.dumps(snap,indent=2)+"\n")
(d/".result.json").unlink()
print("snapshot updated")
PY
