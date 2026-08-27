//! GO-001 -- PKG-LINE-04 end-to-end acceptance (MASTER SPEC 55-63, 79).
//!
//! Asserts against golden/.../expected.json, including every failure condition
//! in SPEC 63. A false-safe result fails this test, which blocks merge.

use csanalyze::{analyze_request, engine::RulePack, model::AnalysisRequest};
use serde_json::Value;
use std::path::PathBuf;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn run() -> (Value, Value) {
    let root = repo();
    let dir = root.join("golden/opportunities/GO-001-PKG-LINE-04");
    let req: AnalysisRequest =
        serde_json::from_str(&std::fs::read_to_string(dir.join("request.json")).unwrap()).unwrap();
    let pack = RulePack::load(
        &std::fs::read_to_string(
            root.join("rulepacks/rockwell")
                .join(format!("{}.json", req.rule_pack)),
        )
        .unwrap(),
    )
    .unwrap();
    let result = analyze_request(&req, &pack, &dir).unwrap();
    let expected: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("expected.json")).unwrap()).unwrap();
    (serde_json::to_value(result).unwrap(), expected)
}

fn findings(r: &Value) -> Vec<&Value> {
    r["findings"].as_array().unwrap().iter().collect()
}

fn finding<'a>(r: &'a Value, id: &str) -> &'a Value {
    findings(r)
        .into_iter()
        .find(|f| f["id"] == id)
        .unwrap_or_else(|| panic!("finding {id} is missing"))
}

#[test]
fn parses_the_system_model_exactly() {
    let (r, e) = run();
    let s = &r["system_model"];
    let x = &e["system_model"];
    assert_eq!(s["processor"], x["processor"]);
    assert_eq!(s["chassis"], x["chassis"]);
    for (slot, catalog) in x["slots"].as_object().unwrap() {
        let n: u64 = slot.parse().unwrap();
        let m = s["modules"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["slot"] == n)
            .unwrap_or_else(|| panic!("slot {slot} not reconstructed"));
        assert_eq!(&m["catalog"], catalog, "slot {slot}");
    }
    let progs = s["programs"].as_array().unwrap();
    let rungs: usize = progs.iter().map(|p| p["rungs"].as_array().unwrap().len()).sum();
    let instrs: usize = progs
        .iter()
        .flat_map(|p| p["rungs"].as_array().unwrap())
        .map(|g| g["instructions"].as_array().unwrap().len())
        .sum();
    assert_eq!(progs.len() as u64, x["program_files"].as_u64().unwrap());
    assert_eq!(rungs as u64, x["rungs"].as_u64().unwrap());
    assert_eq!(instrs as u64, x["instructions"].as_u64().unwrap());
    assert_eq!(
        s["sti"]["interval_ms"].as_u64().unwrap(),
        x["sti_interval_ms"].as_u64().unwrap()
    );
}

#[test]
fn parses_the_golden_without_diagnostics() {
    let (r, _) = run();
    assert_eq!(
        r["diagnostics"].as_array().unwrap().len(),
        0,
        "golden must parse clean: {:?}",
        r["diagnostics"]
    );
}

#[test]
fn every_mandatory_finding_is_present_with_at_least_its_required_state() {
    // Ordered by how safe a state is. A finding may be reported MORE severe
    // than required, never less.
    fn rank(s: &str) -> i32 {
        match s {
            "PASS" => 0,
            "CONDITIONAL" => 1,
            "REVIEW_REQUIRED" => 2,
            "UNKNOWN" => 3,
            "BLOCKED" => 4,
            other => panic!("unknown finding state {other}"),
        }
    }
    let (r, e) = run();
    for req in e["required_findings"].as_array().unwrap() {
        let id = req["id"].as_str().unwrap();
        let f = finding(&r, id);
        assert!(
            rank(f["state"].as_str().unwrap()) >= rank(req["min_state"].as_str().unwrap()),
            "{id}: state {} is safer than the required {}",
            f["state"],
            req["min_state"]
        );
        assert_eq!(f["category"], req["category"], "{id} category");
        if let Some(q) = req["quantity"].as_u64() {
            assert_eq!(f["quantity"].as_u64(), Some(q), "{id} quantity");
        }
    }
}

#[test]
fn quote_readiness_matches_the_commercial_acceptance() {
    let (r, e) = run();
    let q = &r["quote_readiness"];
    let x = &e["quote_readiness"];
    assert_eq!(q["fixed_price"], x["FIXED_PRICE"]);
    assert_eq!(q["budgetary"], x["BUDGETARY"]);
    assert_eq!(q["time_and_material"], x["TIME_AND_MATERIAL"]);
    assert!(
        !q["reasons"].as_array().unwrap().is_empty(),
        "NOT_READY must state why"
    );
}

#[test]
fn migration_paths_reach_the_required_conclusions() {
    let (r, e) = run();
    for want in e["migration_paths"].as_array().unwrap() {
        let id = want["id"].as_str().unwrap();
        let got = r["migration_paths"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == id)
            .unwrap_or_else(|| panic!("migration path {id} missing"));
        assert_eq!(got["conclusion"], want["conclusion"], "path {id}");
        assert_eq!(got["preferred"], want["preferred"], "path {id} preference");
    }
}

// ------------------------------------------------------- SPEC 63 failure set

#[test]
fn spec63_does_not_miss_either_iim_or_call_it_safely_migrated() {
    let (r, _) = run();
    let f = finding(&r, "SW-003");
    assert_eq!(f["quantity"].as_u64(), Some(2), "both IIM must be found");
    assert_eq!(f["state"], "BLOCKED");
}

#[test]
fn spec63_does_not_ignore_devicenet() {
    let (r, _) = run();
    assert_eq!(finding(&r, "NET-001")["state"], "BLOCKED");
    assert_eq!(finding(&r, "NET-002")["state"], "UNKNOWN");
    assert!(
        r["dependencies"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["to"] == "network:DeviceNet"),
        "the SDN scanner must appear in the dependency graph"
    );
}

#[test]
fn spec63_does_not_mark_pid_verified_or_msg_complete() {
    let (r, _) = run();
    for id in ["SW-001", "SW-002"] {
        let f = finding(&r, id);
        assert_ne!(f["state"], "PASS", "{id} must not be PASS");
        assert_eq!(f["engineer_review_required"], true, "{id}");
    }
}

#[test]
fn spec63_invents_no_hmi_migration_effort() {
    let (r, _) = run();
    let hmi = finding(&r, "HMI-001");
    assert_eq!(hmi["state"], "UNKNOWN");
    // The only work an unevidenced HMI may generate is discovery.
    let wp = hmi["work_packages"].as_array().unwrap();
    assert_eq!(wp.len(), 1);
    assert_eq!(wp[0], "DISCOVERY");
    for w in r["work_packages"].as_array().unwrap() {
        let code = w["code"].as_str().unwrap();
        assert!(
            !code.contains("HMI"),
            "no work package may attribute effort to HMI migration: {code}"
        );
    }
}

#[test]
fn spec63_does_not_assume_safety_is_out_of_scope() {
    let (r, _) = run();
    let f = finding(&r, "SAF-001");
    assert_eq!(f["state"], "UNKNOWN");
    assert_ne!(f["state"], "NOT_APPLICABLE");
    assert!(r["unknowns"]
        .as_array()
        .unwrap()
        .iter()
        .any(|u| u["affected_domains"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d == "SAFETY")));
}

#[test]
fn spec63_treats_oem_io_mapping_as_conditional_not_a_guarantee() {
    let (r, _) = run();
    for f in findings(&r) {
        if f["category"] == "IO_COMPATIBILITY" {
            assert_ne!(
                f["state"], "PASS",
                "{} claims field compatibility from an OEM mapping",
                f["id"]
            );
        }
    }
}

#[test]
fn spec63_warns_before_recommending_the_lifecycle_risk_strategy() {
    let (r, _) = run();
    let a = r["migration_paths"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "A")
        .unwrap();
    assert_eq!(a["preferred"], false);
    assert_eq!(a["lifecycle_risk"], "HIGH");
    assert_eq!(finding(&r, "LIFE-002")["severity"], "HIGH");
    assert!(!a["blocking_findings"].as_array().unwrap().is_empty());
}

#[test]
fn spec63_generates_no_procurement_ready_bom() {
    let (r, _) = run();
    let bom = r["candidate_bom"].as_array().unwrap();
    assert!(!bom.is_empty());
    for line in bom {
        assert_eq!(line["state"], "CANDIDATE", "{line}");
        assert!(line["note"]
            .as_str()
            .unwrap()
            .contains("NOT RELEASED FOR PROCUREMENT"));
    }
}

#[test]
fn spec15_no_unknown_is_silently_resolved() {
    let (r, e) = run();
    // Every evidence class the golden deliberately omits must still be missing
    // from coverage -- never quietly counted as present.
    let missing: Vec<String> = r["evidence_coverage"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|d| d["missing"].as_array().unwrap())
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    for key in ["HMI_PROJECT", "DRIVE_BACKUP", "DEVICENET_CONFIGURATION", "AS_BUILT_DRAWING", "SAFETY_ARCHITECTURE"] {
        assert!(missing.contains(&key.to_string()), "{key} must read as missing");
    }
    assert!(!r["unknowns"].as_array().unwrap().is_empty());
    let _ = e;
}

#[test]
fn analysis_is_reproducible_and_versioned() {
    let (a, _) = run();
    let (b, _) = run();
    assert_eq!(a, b, "same input must produce byte-identical output");
    let v = &a["versions"];
    for k in [
        "schema_version",
        "parser_version",
        "ir_schema_version",
        "analysis_engine_version",
        "rule_pack_version",
    ] {
        assert!(!v[k].as_str().unwrap().is_empty(), "{k} must be recorded");
    }
}

#[test]
fn coverage_matches_the_snapshot() {
    let (r, _) = run();
    let snap: Value = serde_json::from_str(
        &std::fs::read_to_string(
            repo().join("golden/opportunities/GO-001-PKG-LINE-04/coverage.snapshot.json"),
        )
        .unwrap(),
    )
    .unwrap();
    for (domain, percent) in snap["domains"].as_object().unwrap() {
        let got = r["evidence_coverage"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["domain"] == domain.as_str())
            .unwrap_or_else(|| panic!("coverage domain {domain} missing"));
        assert_eq!(&got["percent"], percent, "coverage domain {domain}");
    }
    // Coverage is deterministic and never generated by an LLM (SPEC 16).
    assert_eq!(snap["rule_pack"], r["versions"]["rule_pack_version"]);
}
