//! Deterministic analysis: evidence -> coverage -> rules -> findings ->
//! unknowns -> paths -> work packages -> candidate BOM -> quote readiness.
//!
//! No inference is invented here. A rule fires or it does not; absence of
//! evidence produces UNKNOWN and never PASS (MASTER SPEC 15).

use crate::ir::ControlSystem;
use crate::model::*;
use crate::parser::{self, Diagnostic};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};

// ------------------------------------------------------------------ rulepack

#[derive(Debug, Deserialize)]
pub struct RulePack {
    pub id: String,
    pub coverage_domains: Vec<CoverageDomain>,
    pub discontinued_processors: Vec<String>,
    pub io_mapping: Vec<IoMapping>,
    pub rules: Vec<Rule>,
    pub quote_readiness_policy: Policy,
}

#[derive(Debug, Deserialize)]
pub struct CoverageDomain {
    pub id: String,
    pub weight: f64,
    pub requires: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct IoMapping {
    pub from: String,
    pub to: String,
    pub wiring: String,
    pub state: String,
}

#[derive(Debug, Deserialize)]
pub struct Rule {
    pub id: String,
    pub predicate: String,
    #[serde(default)]
    pub args: BTreeMap<String, String>,
    pub category: String,
    pub state: String,
    pub severity: String,
    pub certainty: String,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub work_packages: Vec<String>,
    #[serde(default)]
    pub unit_type: Option<String>,
    #[serde(default)]
    pub evidence: Vec<EvidenceRef>,
    #[serde(default)]
    pub unknown: Option<UnknownTemplate>,
    #[serde(default)]
    pub blocks_paths: Vec<String>,
    #[serde(default)]
    pub affects_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UnknownTemplate {
    pub missing_information: String,
    pub affected_domains: Vec<String>,
    pub commercial_impact: String,
    pub technical_impact: String,
    pub recommended_resolution: String,
    pub estimate_allowance_profile: String,
}

#[derive(Debug, Deserialize)]
pub struct Policy {
    pub fixed_price: FixedPricePolicy,
    pub budgetary: BudgetaryPolicy,
}

#[derive(Debug, Deserialize)]
pub struct FixedPricePolicy {
    pub max_critical_unknowns: u32,
    pub max_unresolved_blockers: u32,
    pub min_weighted_coverage_percent: u32,
    pub requires_engineering_review_complete: bool,
    pub requires_shutdown_feasible: bool,
}

#[derive(Debug, Deserialize)]
pub struct BudgetaryPolicy {
    pub min_weighted_coverage_percent: u32,
}

// ------------------------------------------------------------------ evidence

/// Evidence keys the engine can establish from the supplied artifacts.
///
/// Anything not derivable here is simply absent - the engine does not guess a
/// key into existence, and absence flows to UNKNOWN, never to PASS.
fn evidence_keys(req: &AnalysisRequest, sys: &ControlSystem) -> BTreeSet<String> {
    let mut k = BTreeSet::new();
    for a in &req.artifacts {
        k.insert(a.artifact_type.clone());
    }
    if !sys.processor.is_empty() {
        k.insert("CONTROLLER_IDENTIFIED".into());
    }
    if !sys.modules.is_empty() {
        k.insert("IO_MODULES_IDENTIFIED".into());
    }
    if !sys.programs.is_empty() {
        k.insert("PROGRAM_PARSED".into());
    }
    if req.shutdown_hours.is_some() {
        k.insert("SHUTDOWN_REQUIREMENT".into());
    }
    k.remove("OTHER");
    k
}

fn coverage(pack: &RulePack, keys: &BTreeSet<String>) -> Vec<DomainCoverage> {
    pack.coverage_domains
        .iter()
        .map(|d| {
            let (present, missing): (Vec<String>, Vec<String>) =
                d.requires.iter().cloned().partition(|r| keys.contains(r));
            let percent = if d.requires.is_empty() {
                0
            } else {
                ((present.len() * 100) as f64 / d.requires.len() as f64).round() as u8
            };
            DomainCoverage {
                domain: d.id.clone(),
                percent,
                weight: d.weight,
                present,
                missing,
            }
        })
        .collect()
}

fn weighted_coverage(c: &[DomainCoverage]) -> f64 {
    let tw: f64 = c.iter().map(|d| d.weight).sum();
    if tw == 0.0 {
        return 0.0;
    }
    c.iter().map(|d| d.weight * d.percent as f64).sum::<f64>() / tw
}

// ----------------------------------------------------------------- predicates

struct Hit {
    quantity: Option<u32>,
    source_entities: Vec<String>,
}

/// Closed predicate registry. Rules stay declarative and versioned; the checks
/// they name are compiled and unit-testable.
// ponytail: closed registry, not an expression DSL. Add the DSL only when a
// rule pack must ship a *new kind* of check without an engine release.
fn evaluate(
    rule: &Rule,
    req: &AnalysisRequest,
    sys: &ControlSystem,
    pack: &RulePack,
    keys: &BTreeSet<String>,
) -> Option<Hit> {
    let arg = |k: &str| rule.args.get(k).map(String::as_str).unwrap_or("");
    match rule.predicate.as_str() {
        "always" => Some(Hit {
            quantity: None,
            source_entities: vec![],
        }),
        "processor_discontinued" => {
            pack.discontinued_processors
                .contains(&sys.processor)
                .then(|| Hit {
                    quantity: None,
                    source_entities: vec![format!("processor:{}", sys.processor)],
                })
        }
        "module_present" => {
            let catalog = arg("catalog");
            let slots: Vec<String> = sys
                .modules
                .iter()
                .filter(|m| m.catalog == catalog)
                .map(|m| format!("slot:{}:{}", m.slot, m.catalog))
                .collect();
            (!slots.is_empty()).then_some(Hit {
                quantity: Some(slots.len() as u32),
                source_entities: slots,
            })
        }
        "opcode_count" => {
            let op = arg("opcode").to_string();
            let mut sites: Vec<String> = Vec::new();
            for p in &sys.programs {
                for r in &p.rungs {
                    for i in &r.instructions {
                        if i.source_opcode == op {
                            sites.push(format!("LAD{}:rung{}", p.number, r.index));
                        }
                    }
                }
            }
            (!sites.is_empty()).then_some(Hit {
                quantity: Some(sites.len() as u32),
                source_entities: sites,
            })
        }
        "operand_class_count" => {
            let want_indirect = arg("class") == "INDIRECT";
            let n = sys
                .operands()
                .filter(|o| {
                    if want_indirect {
                        o.indirect
                    } else {
                        o.is_status()
                    }
                })
                .count();
            (n > 0).then(|| Hit {
                quantity: Some(n as u32),
                source_entities: sys
                    .operands()
                    .filter(|o| {
                        if want_indirect {
                            o.indirect
                        } else {
                            o.is_status()
                        }
                    })
                    .map(|o| o.raw.clone())
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect(),
            })
        }
        "sti_present" => sys.sti.as_ref().map(|s| Hit {
            quantity: Some(1),
            source_entities: vec![format!("STI:LAD{}:{}ms", s.program_file, s.interval_ms)],
        }),
        "evidence_absent" => {
            let key = arg("key");
            (!keys.contains(key)).then(|| Hit {
                quantity: None,
                source_entities: vec![format!("missing_evidence:{key}")],
            })
        }
        unknown => {
            // An unrecognized predicate is a rule-pack defect, never a silent PASS.
            let _ = (req, unknown);
            None
        }
    }
}

fn unknown_predicates(pack: &RulePack) -> Vec<String> {
    const KNOWN: [&str; 6] = [
        "always",
        "processor_discontinued",
        "module_present",
        "opcode_count",
        "operand_class_count",
        "sti_present",
    ];
    pack.rules
        .iter()
        .filter(|r| r.predicate != "evidence_absent" && !KNOWN.contains(&r.predicate.as_str()))
        .map(|r| format!("{}:{}", r.id, r.predicate))
        .collect()
}

// ------------------------------------------------------------------ analysis

pub fn analyze(
    req: &AnalysisRequest,
    pack: &RulePack,
    sys: ControlSystem,
    mut diagnostics: Vec<Diagnostic>,
) -> AnalysisResult {
    for bad in unknown_predicates(pack) {
        diagnostics.push(Diagnostic {
            severity: "ERROR".into(),
            code: "E_UNKNOWN_PREDICATE".into(),
            message: format!("rule pack references an unimplemented predicate: {bad}"),
            artifact: pack.id.clone(),
            line: 0,
            column: 0,
        });
    }

    let keys = evidence_keys(req, &sys);
    let cov = coverage(pack, &keys);

    let mut findings = Vec::new();
    let mut unknowns = Vec::new();
    for rule in &pack.rules {
        let Some(hit) = evaluate(rule, req, &sys, pack, &keys) else {
            continue;
        };
        let title = match hit.quantity {
            Some(q) if rule.unit_type.is_some() => format!("{q} {}", rule.title),
            _ => rule.title.clone(),
        };
        findings.push(Finding {
            id: rule.id.clone(),
            rule_id: format!("{}::{}", pack.id, rule.id),
            category: rule.category.clone(),
            title,
            description: rule.description.clone(),
            state: rule.state.clone(),
            severity: rule.severity.clone(),
            certainty: rule.certainty.clone(),
            evidence_strength: if rule.certainty == "UNKNOWN" {
                "NONE".into()
            } else {
                "SUPPORTED".into()
            },
            unit_type: rule.unit_type.clone().unwrap_or_else(|| "ITEM".into()),
            quantity: hit.quantity,
            source_entities: hit.source_entities.into_iter().take(64).collect(),
            affected_entities: vec![],
            work_packages: rule.work_packages.clone(),
            evidence: rule.evidence.clone(),
            engineer_review_required: rule.state != "PASS",
        });
        if let Some(u) = &rule.unknown {
            unknowns.push(Unknown {
                id: format!("UNK-{}", rule.id),
                missing_information: u.missing_information.clone(),
                affected_domains: u.affected_domains.clone(),
                commercial_impact: u.commercial_impact.clone(),
                technical_impact: u.technical_impact.clone(),
                recommended_resolution: u.recommended_resolution.clone(),
                estimate_allowance_profile: u.estimate_allowance_profile.clone(),
                state: "OPEN".into(),
            });
        }
    }

    let dependencies = dependencies(&sys);
    let work_packages = work_packages(&findings);
    let candidate_bom = candidate_bom(pack, &sys);
    let migration_paths = migration_paths(pack, &findings);
    let quote_readiness = readiness(pack, &cov, &findings, &unknowns, req);

    AnalysisResult {
        versions: Versions {
            schema_version: SCHEMA_VERSION.into(),
            parser_version: parser::PARSER_VERSION.into(),
            ir_schema_version: sys.ir_schema_version.clone(),
            analysis_engine_version: ENGINE_VERSION.into(),
            rule_pack_version: pack.id.clone(),
        },
        opportunity_id: req.opportunity_id.clone(),
        system_model: sys,
        evidence_coverage: cov,
        findings,
        unknowns,
        dependencies,
        migration_paths,
        work_packages,
        candidate_bom,
        quote_readiness,
        diagnostics,
    }
}

/// Address -> module -> slot, and MSG -> network. Deduplicated, so the graph
/// stays the size of the system rather than the size of the program.
fn dependencies(sys: &ControlSystem) -> Vec<Dependency> {
    let mut set = BTreeSet::new();
    for p in &sys.programs {
        for r in &p.rungs {
            for i in &r.instructions {
                for o in i.reads() {
                    if let Some(slot) = o.io_slot() {
                        set.insert((
                            o.raw.clone(),
                            "READ_BY".to_string(),
                            format!("LAD{}", p.number),
                        ));
                        add_module_edge(sys, slot, &o.raw, &mut set);
                    }
                }
                for o in i.writes() {
                    if let Some(slot) = o.io_slot() {
                        set.insert((
                            format!("LAD{}", p.number),
                            "WRITES".to_string(),
                            o.raw.clone(),
                        ));
                        add_module_edge(sys, slot, &o.raw, &mut set);
                    }
                }
                if i.source_opcode == "MSG" {
                    set.insert((
                        format!("LAD{}:rung{}:MSG", p.number, r.index),
                        "TARGETS_NETWORK".into(),
                        "network:UNDETERMINED".into(),
                    ));
                }
            }
        }
    }
    for m in &sys.modules {
        if m.catalog == "1747-SDN" {
            set.insert((
                format!("slot:{}:{}", m.slot, m.catalog),
                "SCANS".into(),
                "network:DeviceNet".into(),
            ));
            set.insert((
                "network:DeviceNet".into(),
                "NODE_INVENTORY".into(),
                "UNDETERMINED".into(),
            ));
        }
    }
    set.into_iter()
        .map(|(from, relation, to)| Dependency { from, relation, to })
        .collect()
}

fn add_module_edge(
    sys: &ControlSystem,
    slot: u8,
    addr: &str,
    set: &mut BTreeSet<(String, String, String)>,
) {
    if let Some(m) = sys.module_in_slot(slot) {
        set.insert((
            addr.to_string(),
            "MAPS_TO_MODULE".into(),
            format!("slot:{}:{}", m.slot, m.catalog),
        ));
    }
}

/// Work packages are keyed by (code, unit type). Two findings that trigger the
/// same package in DIFFERENT units are different lines: 2 instruction rewrites
/// and 11 indirect references are not 13 of anything. Summing them once
/// produced a 13-unit line that priced two IIM rewrites as thirteen.
fn work_packages(findings: &[Finding]) -> Vec<WorkPackageRef> {
    let mut acc: BTreeMap<(String, String), (u32, Vec<String>)> = BTreeMap::new();
    for f in findings {
        let unit = f.unit_type.clone();
        for wp in &f.work_packages {
            let e = acc.entry((wp.clone(), unit.clone())).or_insert((0, vec![]));
            e.0 += f.quantity.unwrap_or(1);
            e.1.push(f.id.clone());
        }
    }
    acc.into_iter()
        .map(
            |((code, unit_type), (quantity, triggered_by))| WorkPackageRef {
                code,
                unit_type,
                quantity,
                triggered_by,
            },
        )
        .collect()
}

/// Advisory only. Every line is CANDIDATE - the engine never releases hardware
/// for procurement (MASTER SPEC 40).
fn candidate_bom(pack: &RulePack, sys: &ControlSystem) -> Vec<BomLine> {
    let mut counts: BTreeMap<&str, u32> = BTreeMap::new();
    for m in &sys.modules {
        *counts.entry(m.catalog.as_str()).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .map(|(catalog, quantity)| match pack.io_mapping.iter().find(|m| m.from == catalog) {
            Some(map) => BomLine {
                catalog: map.to.clone(),
                quantity,
                replaces: catalog.to_string(),
                state: "CANDIDATE".into(),
                note: format!(
                    "CANDIDATE - NOT RELEASED FOR PROCUREMENT. Mapping state {}. Wiring: {}.",
                    map.state, map.wiring
                ),
            },
            None => BomLine {
                catalog: "UNDETERMINED".into(),
                quantity,
                replaces: catalog.to_string(),
                state: "CANDIDATE".into(),
                note: "CANDIDATE - NOT RELEASED FOR PROCUREMENT. No mapping in this rule pack; engineering selection required.".into(),
            },
        })
        .collect()
}

fn migration_paths(_pack: &RulePack, findings: &[Finding]) -> Vec<MigrationPath> {
    let blocking = |p: &str| -> Vec<String> {
        findings
            .iter()
            .filter(|f| f.state == "BLOCKED")
            .filter(|f| {
                // NET-001 blocks the preserved-I/O path specifically; every other
                // blocker blocks whichever path still carries the construct.
                f.id != "NET-001" || p == "A"
            })
            .map(|f| f.id.clone())
            .collect()
    };
    vec![
        MigrationPath {
            id: "A".into(),
            name: "Transitional".into(),
            strategy: "PRESERVE_1746_IO".into(),
            conclusion: "TECHNICALLY_POSSIBLE_WITH_EXCEPTIONS".into(),
            lifecycle_risk: "HIGH".into(),
            preferred: false,
            blocking_findings: blocking("A"),
            notes: vec![
                "NOT PREFERRED AS FINAL ARCHITECTURE".into(),
                "Retains discontinued 1746 I/O in the delivered system.".into(),
            ],
        },
        MigrationPath {
            id: "B".into(),
            name: "Preferred Candidate".into(),
            strategy: "COMPACT_5000_IO".into(),
            conclusion: "PREFERRED_CANDIDATE".into(),
            lifecycle_risk: "MEDIUM".into(),
            preferred: true,
            blocking_findings: blocking("B"),
            notes: vec![
                "FINAL ENGINEERING VALIDATION REQUIRED".into(),
                "CompactLogix 5380 + Compact 5000 I/O + 1492 wiring conversion.".into(),
                "DeviceNet requires a transition strategy, not a carry-over.".into(),
            ],
        },
        MigrationPath {
            id: "C".into(),
            name: "Full Modernization".into(),
            strategy: "FULL_MODERNIZATION".into(),
            conclusion: "LONG_TERM_ATTRACTIVE".into(),
            lifecycle_risk: "LOW".into(),
            preferred: false,
            blocking_findings: blocking("C"),
            notes: vec![
                "FIXED-PRICE FEASIBILITY UNKNOWN".into(),
                "Includes HMI, drives and legacy network replacement, none of which are evidenced."
                    .into(),
            ],
        },
    ]
}

/// Deterministic gate (MASTER SPEC 35). Engineering review completion and
/// shutdown feasibility are human determinations: the engine cannot assert
/// them, so it reports them unsatisfied rather than assuming them true.
fn readiness(
    pack: &RulePack,
    cov: &[DomainCoverage],
    findings: &[Finding],
    unknowns: &[Unknown],
    req: &AnalysisRequest,
) -> QuoteReadiness {
    let wc = weighted_coverage(cov);
    let blockers: Vec<&Finding> = findings.iter().filter(|f| f.state == "BLOCKED").collect();
    let critical: Vec<&Unknown> = unknowns
        .iter()
        .filter(|u| u.estimate_allowance_profile == "RESOLVE_BEFORE_QUOTE")
        .collect();
    let fp = &pack.fixed_price_policy();

    let mut reasons = Vec::new();
    if critical.len() as u32 > fp.max_critical_unknowns {
        reasons.push(format!(
            "{} critical unknown(s) must be resolved before a fixed price: {}",
            critical.len(),
            critical
                .iter()
                .map(|u| u.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if blockers.len() as u32 > fp.max_unresolved_blockers {
        reasons.push(format!(
            "{} unresolved blocking finding(s): {}",
            blockers.len(),
            blockers
                .iter()
                .map(|f| f.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if (wc.round() as u32) < fp.min_weighted_coverage_percent {
        reasons.push(format!(
            "weighted evidence coverage {:.0}% is below the {}% fixed-price threshold",
            wc, fp.min_weighted_coverage_percent
        ));
    }
    if fp.requires_engineering_review_complete && !req.engineering_review_complete {
        reasons.push("engineering review of findings is not complete".into());
    }
    if fp.requires_shutdown_feasible && !req.shutdown_feasible {
        reasons.push(match req.shutdown_hours {
            Some(h) => format!(
                "shutdown feasibility within {h} h cannot be established while the DeviceNet, HMI, drive and safety scope are unknown"
            ),
            None => "no shutdown requirement supplied; feasibility cannot be established".into(),
        });
    }

    let fixed_price = if reasons.is_empty() {
        "READY"
    } else {
        "NOT_READY"
    };
    let budgetary = if (wc.round() as u32) >= pack.budgetary_policy().min_weighted_coverage_percent
    {
        if unknowns.is_empty() {
            "READY"
        } else {
            "READY_WITH_ALLOWANCES"
        }
    } else {
        "NOT_READY"
    };

    QuoteReadiness {
        fixed_price: fixed_price.into(),
        budgetary: budgetary.into(),
        time_and_material: "READY".into(),
        reasons,
    }
}

impl RulePack {
    fn fixed_price_policy(&self) -> &FixedPricePolicy {
        &self.quote_readiness_policy.fixed_price
    }
    fn budgetary_policy(&self) -> &BudgetaryPolicy {
        &self.quote_readiness_policy.budgetary
    }
    pub fn load(json: &str) -> Result<RulePack, String> {
        serde_json::from_str(json).map_err(|e| format!("rule pack is not valid: {e}"))
    }
}
