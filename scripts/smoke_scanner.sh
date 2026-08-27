#!/usr/bin/env bash
# Proves the wired scanner against a REAL ClamAV, using the EICAR test string.
#
#   scripts/smoke_scanner.sh
#
# EICAR is not malware: it is the string every scanner has agreed to flag, so a
# clean run here means signatures are loaded and the INSTREAM path works.
set -euo pipefail
HOST="${CLAMD_HOST:-127.0.0.1}"
PORT="${CLAMD_PORT:-3310}"

python - "$HOST" "$PORT" <<'PY'
import socket, struct, sys
host, port = sys.argv[1], int(sys.argv[2])

def instream(payload: bytes) -> str:
    s = socket.create_connection((host, port), timeout=30)
    s.sendall(b"zINSTREAM\0")
    for i in range(0, len(payload), 8192):
        chunk = payload[i:i + 8192]
        s.sendall(struct.pack("!I", len(chunk)) + chunk)
    s.sendall(struct.pack("!I", 0))
    reply = b""
    while True:
        part = s.recv(4096)
        if not part:
            break
        reply += part
    s.close()
    return reply.decode("utf-8", "replace").replace("\0", "").strip()

eicar = rb"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
clean = b"SOR XIC I:1/0 OTE O:4/0 EOR\n"

infected, ok = instream(eicar), instream(clean)
print(f"  EICAR      -> {infected}")
print(f"  clean rung -> {ok}")

if "FOUND" not in infected:
    sys.exit("FAIL: the scanner did not flag EICAR. Signatures may not be loaded.")
if not ok.endswith("OK"):
    sys.exit(f"FAIL: a clean file did not come back OK: {ok}")
print("  scanner is live and flagging correctly")
PY
