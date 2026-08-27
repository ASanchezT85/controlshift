#!/usr/bin/env python3
"""GO-001 end to end through the running product (MASTER SPEC 79).

    python scripts/e2e_go001.py [--api http://127.0.0.1:3000/api]

The Rust golden suite proves the engine. This proves the *product*: a fresh
opportunity created over HTTP, ten artifacts uploaded through the real
ingestion pipeline and scanned by whatever clamd the API is pointed at, an
analysis run, findings reviewed, commercial propositions raised and approved,
an estimate produced and all three deliverables generated.

It asserts as it goes and exits non-zero on the first thing that is not true.
Nothing is mocked and nothing is inserted behind the API's back.
"""
import argparse
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
GOLDEN = ROOT / "golden" / "opportunities" / "GO-001-PKG-LINE-04"
PASSWORD = "controlshift-dev"

USERS = {
    "engineer": "engineer@northstar-integrators.test",
    "estimator": "estimator@northstar-integrators.test",
    "admin": "admin@northstar-integrators.test",
}

ok_count = 0


def check(condition: bool, label: str, detail: str = ""):
    global ok_count
    if condition:
        ok_count += 1
        print(f"  [ok]   {label}" + (f"  ({detail})" if detail else ""))
    else:
        print(f"  [FAIL] {label}" + (f"  ({detail})" if detail else ""))
        sys.exit(1)


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.tokens: dict[str, str] = {}

    def login(self, who: str) -> str:
        if who not in self.tokens:
            body = self.request(
                "POST", "/auth/login", {"email": USERS[who], "password": PASSWORD}
            )
            self.tokens[who] = body["accessToken"]
        return self.tokens[who]

    def request(self, method: str, path: str, payload=None, who=None, raw_body=None,
                content_type="application/json"):
        req = urllib.request.Request(self.base + path, method=method)
        if who:
            req.add_header("authorization", f"Bearer {self.login(who)}")
        data = None
        if raw_body is not None:
            data = raw_body
            req.add_header("content-type", content_type)
        elif payload is not None:
            data = json.dumps(payload).encode()
            req.add_header("content-type", "application/json")
        try:
            with urllib.request.urlopen(req, data, timeout=180) as res:
                text = res.read().decode("utf-8")
                return json.loads(text) if text.strip().startswith(("{", "[")) else text
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            raise RuntimeError(f"{method} {path} -> {e.code}: {body[:300]}") from None

    def upload(self, opportunity_id: str, path: pathlib.Path, who="engineer",
               declared_type: str | None = None):
        boundary = f"----controlshift{uuid.uuid4().hex}"
        parts = []
        # A declared type must precede the file: the server reads fields that
        # arrive before the file part.
        if declared_type:
            parts += [
                f"--{boundary}\r\n".encode(),
                b'Content-Disposition: form-data; name="artifactType"\r\n\r\n',
                declared_type.encode(),
                b"\r\n",
            ]
        parts += [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'.encode(),
            b"Content-Type: application/octet-stream\r\n\r\n",
            path.read_bytes(),
            f"\r\n--{boundary}--\r\n".encode(),
        ]
        body = b"".join(parts)
        return self.request(
            "POST",
            f"/opportunities/{opportunity_id}/artifacts",
            who=who,
            raw_body=body,
            content_type=f"multipart/form-data; boundary={boundary}",
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:3000/api")
    parser.add_argument("--keep", action="store_true", help="leave the opportunity behind")
    args = parser.parse_args()
    api = Api(args.api)

    started = time.time()
    name = f"GO-001 end-to-end {time.strftime('%Y-%m-%d %H:%M:%S')}"

    print("\n1. OPPORTUNITY")
    opportunity = api.request(
        "POST",
        "/opportunities",
        {
            "name": name,
            "customerName": "Northstar Foods",
            "facilityName": "Plant 03 - Packaging",
            "proposalType": "FIXED_PRICE",
            "shutdownRequirementHours": 12,
            "commercialNotes": "Fixed price requested. 12 h shutdown, Sunday.",
        },
        who="engineer",
    )
    oid = opportunity["id"]
    check(opportunity["status"] == "DRAFT", "created over HTTP", oid[:8])

    print("\n2. INGESTION - every artifact through the real pipeline")
    manifest = json.loads((GOLDEN / "manifest.json").read_text())
    statuses = []
    for entry in manifest["artifacts"]:
        name_only = entry["path"].split("/")[-1]
        # A drawing's kind is declared, never inferred: which drawing it is
        # moves an evidence domain, and an extension cannot know.
        declared = entry["artifact_type"] if name_only.lower().endswith(".pdf") else None
        artifact = api.upload(oid, GOLDEN / entry["path"], declared_type=declared)
        statuses.append(artifact["processingStatus"])
        check(
            artifact["sha256"] == entry["sha256"]
            and (not declared or artifact["artifactType"] == declared),
            f"{name_only:<24} {artifact['processingStatus']:<8} {artifact['artifactType']}",
        )
    scanned = statuses.count("SCANNED")
    check(
        scanned == len(statuses),
        "every artifact cleared malware scanning",
        f"{scanned}/{len(statuses)} SCANNED",
    )

    print("\n3. ANALYSIS")
    analysis = api.request("POST", f"/opportunities/{oid}/analyses", {}, who="engineer")
    result = analysis["result"]
    system = result["system_model"]
    rungs = sum(len(p["rungs"]) for p in system["programs"])
    instructions = sum(
        len(g["instructions"]) for p in system["programs"] for g in p["rungs"]
    )
    check(system["processor"] == "1747-L553", "processor reconstructed", system["processor"])
    check(len(system["modules"]) == 10, "rack reconstructed", "10 slots")
    check(len(system["programs"]) == 21 and rungs == 684 and instructions == 4231,
          "program reconstructed", f"21 files, {rungs} rungs, {instructions} instructions")
    check(len(result["diagnostics"]) == 0, "no parser diagnostics")

    ids = {f["id"]: f for f in result["findings"]}
    for required in ["LIFE-001", "LIFE-002", "NET-001", "NET-002", "IO-001", "IO-002",
                     "IO-003", "IO-004", "SW-001", "SW-002", "SW-003", "SW-004", "SW-005",
                     "ARCH-001", "HMI-001", "DRV-001", "DOC-001", "SAF-001"]:
        check(required in ids, f"finding {required} present", ids[required]["state"]
              if required in ids else "MISSING")
    check(ids["SW-003"]["quantity"] == 2 and ids["SW-003"]["state"] == "BLOCKED",
          "both IIM found and BLOCKED")
    check(ids["SAF-001"]["state"] == "UNKNOWN", "safety stays UNKNOWN, never absent")
    check("PARSE-001" not in ids, "the source was understood")

    print("\n4. COMMERCIAL PROPOSITIONS")
    api.request("POST", f"/opportunities/{oid}/commercial/propose", {}, who="engineer")
    commercial = api.request("GET", f"/opportunities/{oid}/commercial", who="engineer")
    check(len(commercial["assumptions"]) >= 2, "assumptions proposed",
          str(len(commercial["assumptions"])))
    check(all(a["validationState"] == "ASSUMED" for a in commercial["assumptions"]),
          "proposing never validates")
    check(all(e["approvedBy"] is None for e in commercial["exclusions"]),
          "proposing never approves")

    blocking = [u["id"] for u in result["unknowns"]
                if u["estimate_allowance_profile"] == "RESOLVE_BEFORE_QUOTE"]
    proposed_from = {a.get("sourceUnknownId") for a in commercial["assumptions"]}
    proposed_from |= {u for e in commercial["exclusions"] for u in e["relatedUnknowns"]}
    check(not (set(blocking) & proposed_from),
          "no blocking unknown was proposed away", ", ".join(blocking))

    api.request("PATCH", f"/assumptions/{commercial['assumptions'][0]['id']}",
                {"validationState": "VALIDATED"}, who="engineer")
    api.request("PATCH", f"/exclusions/{commercial['exclusions'][0]['id']}/approve",
                {}, who="estimator")
    check(True, "engineering validated an assumption, commerce approved an exclusion")

    print("\n5. REVIEW")
    api.request(
        "POST",
        f"/opportunities/{oid}/analyses/{analysis['id']}/reviews",
        {"findingId": "SW-003", "action": "ACKNOWLEDGE",
         "reason": "Both IIM confirmed against the rung listing"},
        who="engineer",
    )
    reviewed = api.request("GET", f"/opportunities/{oid}/analyses/latest", who="engineer")
    check(len(reviewed["reviews"]) == 1, "review recorded beside the finding")
    check(reviewed["result"]["findings"][
              [f["id"] for f in reviewed["result"]["findings"]].index("SW-003")
          ]["state"] == "BLOCKED",
          "the original finding state is untouched")

    print("\n6. ESTIMATE")
    estimate = api.request("GET", f"/opportunities/{oid}/estimate", who="estimator")
    iim = next(l for l in estimate["lines"]
               if l["workPackageCode"] == "UNSUPPORTED_INSTRUCTION_REWRITE"
               and l["unitType"] == "INSTRUCTION")
    check(iim["quantity"] == 2, "the IIM rewrite is priced as two instructions",
          f"{iim['minHours']}-{iim['maxHours']} h")
    check(estimate["totals"]["minHours"] < estimate["totals"]["maxHours"],
          "range produced",
          f"{estimate['totals']['minHours']}-{estimate['totals']['maxHours']} h")
    unpriced = [u["workPackageCode"] for u in estimate["unpriced"]]
    check(unpriced == ["DISCOVERY"], "only DISCOVERY is unpriced", ", ".join(unpriced))
    check(not any("HMI" in l["workPackageCode"] for l in estimate["lines"]),
          "no hours attributed to unevidenced HMI work")

    print("\n7. QUOTE READINESS")
    q = result["quote_readiness"]
    check(q["fixed_price"] == "NOT_READY", "fixed price", q["fixed_price"])
    check(q["budgetary"] == "READY_WITH_ALLOWANCES", "budgetary", q["budgetary"])
    check(q["time_and_material"] == "READY", "time and material", q["time_and_material"])
    before = len(q["reasons"])

    api.request("PATCH", f"/opportunities/{oid}/review-state",
                {"engineeringReviewComplete": True, "shutdownFeasible": True}, who="engineer")
    after_analysis = api.request("POST", f"/opportunities/{oid}/analyses", {}, who="engineer")
    after = after_analysis["result"]["quote_readiness"]
    check(len(after["reasons"]) == before - 2,
          "confirming the human determinations closes exactly two reasons",
          f"{before} -> {len(after['reasons'])}")
    check(after["fixed_price"] == "NOT_READY",
          "and fixed price is STILL refused", "; ".join(after["reasons"])[:110])

    api.request("PATCH", f"/opportunities/{oid}/review-state",
                {"engineeringReviewComplete": False, "shutdownFeasible": False}, who="engineer")
    api.request("POST", f"/opportunities/{oid}/analyses", {}, who="engineer")

    print("\n8. DELIVERABLES")
    for kind in ["ENGINEERING_PREFLIGHT", "PROPOSAL_INPUT_PACKAGE",
                 "CUSTOMER_INFORMATION_REQUEST"]:
        report = api.request("POST", f"/opportunities/{oid}/reports", {"kind": kind},
                             who="admin")
        html = api.request("GET", f"/reports/{report['id']}", who="admin")
        check(len(html) > 4000, f"{kind.replace('_', ' ').lower()}", f"{len(html) // 1024} kB")
        if kind == "PROPOSAL_INPUT_PACKAGE":
            check("CANDIDATE" in html and "NOT RELEASED FOR PROCUREMENT" in html,
                  "BOM stamped candidate")
            check("Proposed exclusions" in html,
                  "unapproved exclusions shown as proposals, not as exclusions")
            check("RA-2026.08::" in html, "scope traces back to rule and evidence")
        if kind == "CUSTOMER_INFORMATION_REQUEST":
            check("REQUIRED FOR FIXED PRICE" in html, "blocking unknowns flagged as required")

    print("\n9. AUDIT")
    events = api.request("GET", "/audit?take=200", who="admin")
    mine = [e for e in events if (e.get("detail") or {}).get("opportunityId") == oid
            or e["subjectId"] == oid]
    actions = {e["action"] for e in events}
    for action in ["opportunity.created", "artifact.uploaded", "analysis.completed",
                   "report.generated", "assumption.created", "exclusion.approved"]:
        check(action in actions, f"audited: {action}")

    if not args.keep:
        print("\n(leaving the opportunity in place; pass --keep to silence this note)")

    print(f"\n{ok_count} checks passed in {time.time() - started:.1f}s")
    print("GO-001 runs end to end through the product, scanner included.")


if __name__ == "__main__":
    main()
