//! Golden test classes G1 (atomic) and G2 (composite) - MASTER SPEC 64/65/73.
//!
//! Every directory under golden/atomic and golden/composite holds `source.SLC`
//! plus a `case.json` of expectations. Adding a case is adding two files; no
//! Rust changes. The suite also enforces SPEC 73: every rule in the pack must
//! own at least a positive and a negative fixture.

use csanalyze::{
    analyze_request,
    engine::RulePack,
    model::{AnalysisRequest, AnalysisResult, ArtifactRef},
};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
struct Case {
    id: String,
    description: String,
    /// Extra evidence types declared present. No file is read for these - the
    /// engine only ever opens the PLC source.
    #[serde(default)]
    evidence: Vec<String>,
    #[serde(default)]
    shutdown_hours: Option<f64>,
    #[serde(default)]
    engineering_review_complete: bool,
    #[serde(default)]
    shutdown_feasible: bool,

    #[serde(default)]
    expect_findings: Vec<ExpectedFinding>,
    #[serde(default)]
    expect_absent: Vec<String>,
    #[serde(default)]
    expect_diagnostics: Vec<String>,
    #[serde(default)]
    expect_quote_readiness: Option<ExpectedReadiness>,
    #[serde(default)]
    expect_reason_contains: Vec<String>,
    #[serde(default)]
    expect_path_blocked: std::collections::BTreeMap<String, Vec<String>>,
    #[serde(default)]
    expect_min_blockers: Option<usize>,
    #[serde(default)]
    expect_no_unknowns: bool,
    #[serde(default)]
    expect_no_pass_findings: bool,
}

#[derive(Debug, Deserialize)]
struct ExpectedFinding {
    id: String,
    state: String,
    #[serde(default)]
    quantity: Option<u32>,
}

#[derive(Debug, Deserialize, Default)]
struct ExpectedReadiness {
    #[serde(default)]
    fixed_price: Option<String>,
    #[serde(default)]
    budgetary: Option<String>,
    #[serde(default)]
    time_and_material: Option<String>,
}

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn rule_pack() -> RulePack {
    RulePack::load(
        &std::fs::read_to_string(repo().join("rulepacks/rockwell/RA-2026.08.json")).unwrap(),
    )
    .unwrap()
}

fn case_dirs(class: &str) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(repo().join("golden").join(class))
        .unwrap_or_else(|e| panic!("golden/{class}: {e}"))
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.join("case.json").is_file())
        .collect();
    dirs.sort();
    assert!(!dirs.is_empty(), "golden/{class} has no cases");
    dirs
}

fn load(dir: &Path) -> Case {
    serde_json::from_str(&std::fs::read_to_string(dir.join("case.json")).unwrap())
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
}

fn run(dir: &Path, case: &Case, pack: &RulePack) -> AnalysisResult {
    let mut artifacts = vec![ArtifactRef {
        path: "source.SLC".into(),
        artifact_type: "PLC_SOURCE".into(),
        sha256: String::new(),
        size: 0,
    }];
    for e in &case.evidence {
        artifacts.push(ArtifactRef {
            path: format!("declared/{e}"),
            artifact_type: e.clone(),
            sha256: String::new(),
            size: 0,
        });
    }
    let req = AnalysisRequest {
        schema_version: "1.0.0".into(),
        opportunity_id: case.id.clone(),
        artifacts,
        target_strategy: "COMPACT_5000_IO".into(),
        target_controller: "CompactLogix 5380".into(),
        proposal_type: "FIXED_PRICE".into(),
        shutdown_hours: case.shutdown_hours,
        engineering_review_complete: case.engineering_review_complete,
        shutdown_feasible: case.shutdown_feasible,
        rule_pack: "RA-2026.08".into(),
    };
    analyze_request(&req, pack, dir).unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
}

fn check(dir: &Path, pack: &RulePack) {
    let case = load(dir);
    let r = run(dir, &case, pack);
    let ctx = format!("{} ({})", case.id, case.description);

    for want in &case.expect_findings {
        let f = r
            .findings
            .iter()
            .find(|f| f.id == want.id)
            .unwrap_or_else(|| panic!("{ctx}: finding {} is missing", want.id));
        assert_eq!(f.state, want.state, "{ctx}: {} state", want.id);
        if want.quantity.is_some() {
            assert_eq!(f.quantity, want.quantity, "{ctx}: {} quantity", want.id);
        }
    }
    for id in &case.expect_absent {
        assert!(
            !r.findings.iter().any(|f| &f.id == id),
            "{ctx}: {id} fired but this case must not trigger it"
        );
    }
    for code in &case.expect_diagnostics {
        assert!(
            r.diagnostics.iter().any(|d| &d.code == code),
            "{ctx}: expected diagnostic {code}, got {:?}",
            r.diagnostics.iter().map(|d| &d.code).collect::<Vec<_>>()
        );
    }
    if let Some(q) = &case.expect_quote_readiness {
        if let Some(v) = &q.fixed_price {
            assert_eq!(&r.quote_readiness.fixed_price, v, "{ctx}: fixed price");
        }
        if let Some(v) = &q.budgetary {
            assert_eq!(&r.quote_readiness.budgetary, v, "{ctx}: budgetary");
        }
        if let Some(v) = &q.time_and_material {
            assert_eq!(&r.quote_readiness.time_and_material, v, "{ctx}: T&M");
        }
    }
    for needle in &case.expect_reason_contains {
        assert!(
            r.quote_readiness
                .reasons
                .iter()
                .any(|s| s.to_lowercase().contains(&needle.to_lowercase())),
            "{ctx}: no readiness reason mentions `{needle}`: {:?}",
            r.quote_readiness.reasons
        );
    }
    for (path_id, blockers) in &case.expect_path_blocked {
        let p = r
            .migration_paths
            .iter()
            .find(|p| &p.id == path_id)
            .unwrap_or_else(|| panic!("{ctx}: path {path_id} missing"));
        for b in blockers {
            assert!(
                p.blocking_findings.contains(b),
                "{ctx}: path {path_id} should be blocked by {b}"
            );
        }
    }
    if let Some(min) = case.expect_min_blockers {
        let n = r.findings.iter().filter(|f| f.state == "BLOCKED").count();
        if min == 0 {
            assert_eq!(n, 0, "{ctx}: expected no blockers, got {n}");
        } else {
            assert!(n >= min, "{ctx}: expected >= {min} blockers, got {n}");
        }
    }
    if case.expect_no_unknowns {
        assert!(
            r.unknowns.is_empty(),
            "{ctx}: evidence is complete, no unknown should remain: {:?}",
            r.unknowns.iter().map(|u| &u.id).collect::<Vec<_>>()
        );
    }
    if case.expect_no_pass_findings {
        assert!(
            !r.findings.iter().any(|f| f.state == "PASS"),
            "{ctx}: malformed input must never yield a PASS finding"
        );
    }

    // Invariants every case must hold, declared or not.
    assert!(
        !r.findings.iter().any(|f| f.state == "PASS"),
        "{ctx}: V1 emits no PASS findings - a rule that fires always needs review"
    );
    for line in &r.candidate_bom {
        assert_eq!(line.state, "CANDIDATE", "{ctx}: BOM line {}", line.catalog);
    }
    for f in &r.findings {
        if f.state == "UNKNOWN" {
            assert_eq!(
                f.evidence_strength, "NONE",
                "{ctx}: {} is UNKNOWN but claims evidence",
                f.id
            );
        }
    }
}

#[test]
fn g1_atomic_cases() {
    let pack = rule_pack();
    for dir in case_dirs("atomic") {
        check(&dir, &pack);
    }
}

#[test]
fn g2_composite_cases() {
    let pack = rule_pack();
    for dir in case_dirs("composite") {
        check(&dir, &pack);
    }
}

/// SPEC 73: a rule with no fixture is an untested rule. `always` rules are
/// exempt from the negative fixture - by construction they cannot be silent.
#[test]
fn every_rule_has_a_positive_and_a_negative_fixture() {
    let pack = rule_pack();
    let cases: Vec<Case> = case_dirs("atomic")
        .into_iter()
        .chain(case_dirs("composite"))
        .map(|d| load(&d))
        .collect();

    let mut missing = Vec::new();
    for rule in &pack.rules {
        let positive = cases
            .iter()
            .any(|c| c.expect_findings.iter().any(|f| f.id == rule.id));
        let negative = cases.iter().any(|c| c.expect_absent.contains(&rule.id));
        if !positive {
            missing.push(format!("{} has no positive fixture", rule.id));
        }
        if !negative && rule.predicate != "always" {
            missing.push(format!("{} has no negative fixture", rule.id));
        }
    }
    assert!(missing.is_empty(), "untested rules:\n  {}", missing.join("\n  "));
}

/// Every case must actually assert something, or it is decoration.
#[test]
fn no_case_is_vacuous() {
    for dir in case_dirs("atomic").into_iter().chain(case_dirs("composite")) {
        let c = load(&dir);
        let asserts = c.expect_findings.len()
            + c.expect_absent.len()
            + c.expect_diagnostics.len()
            + c.expect_reason_contains.len()
            + c.expect_path_blocked.len()
            + usize::from(c.expect_quote_readiness.is_some())
            + usize::from(c.expect_min_blockers.is_some())
            + usize::from(c.expect_no_unknowns)
            + usize::from(c.expect_no_pass_findings);
        assert!(asserts > 0, "{} asserts nothing", c.id);
        assert!(!c.description.is_empty(), "{} has no description", c.id);
    }
}
