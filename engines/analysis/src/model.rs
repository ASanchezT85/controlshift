//! Versioned request/result contract (MASTER SPEC 69/70).
//! Rust internals never leak into this contract.

use crate::ir::ControlSystem;
use crate::parser::Diagnostic;
use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: &str = "1.0.0";
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactRef {
    pub path: String,
    pub artifact_type: String,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisRequest {
    pub schema_version: String,
    pub opportunity_id: String,
    pub artifacts: Vec<ArtifactRef>,
    /// `PRESERVE_1746_IO` | `COMPACT_5000_IO` | `FULL_MODERNIZATION`
    #[serde(default = "default_strategy")]
    pub target_strategy: String,
    #[serde(default = "default_target")]
    pub target_controller: String,
    #[serde(default)]
    pub proposal_type: String,
    #[serde(default)]
    pub shutdown_hours: Option<f64>,
    /// Human determinations the engine cannot make for itself (SPEC 35).
    /// Absent means NOT established - never assumed true.
    #[serde(default)]
    pub engineering_review_complete: bool,
    #[serde(default)]
    pub shutdown_feasible: bool,
    pub rule_pack: String,
}

fn default_strategy() -> String {
    "COMPACT_5000_IO".into()
}
fn default_target() -> String {
    "CompactLogix 5380".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Finding {
    pub id: String,
    pub rule_id: String,
    pub category: String,
    pub title: String,
    pub description: String,
    pub state: String,
    pub severity: String,
    pub certainty: String,
    pub evidence_strength: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantity: Option<u32>,
    pub source_entities: Vec<String>,
    pub affected_entities: Vec<String>,
    pub work_packages: Vec<String>,
    pub evidence: Vec<EvidenceRef>,
    pub engineer_review_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EvidenceRef {
    /// `STRUCTURED_PARSE` | `OEM` | `USER_DECLARATION` | `ABSENT`
    pub source_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publication_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locator: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Unknown {
    pub id: String,
    pub missing_information: String,
    pub affected_domains: Vec<String>,
    pub commercial_impact: String,
    pub technical_impact: String,
    pub recommended_resolution: String,
    /// `EXCLUDE` | `ALLOWANCE` | `RESOLVE_BEFORE_QUOTE`
    pub estimate_allowance_profile: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DomainCoverage {
    pub domain: String,
    pub percent: u8,
    pub weight: f64,
    pub present: Vec<String>,
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Dependency {
    pub from: String,
    pub relation: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MigrationPath {
    pub id: String,
    pub name: String,
    pub strategy: String,
    pub conclusion: String,
    pub lifecycle_risk: String,
    pub preferred: bool,
    pub blocking_findings: Vec<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BomLine {
    pub catalog: String,
    pub quantity: u32,
    pub replaces: String,
    pub state: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkPackageRef {
    pub code: String,
    pub unit_type: String,
    pub quantity: u32,
    pub triggered_by: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QuoteReadiness {
    pub fixed_price: String,
    pub budgetary: String,
    pub time_and_material: String,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Versions {
    pub schema_version: String,
    pub parser_version: String,
    pub ir_schema_version: String,
    pub analysis_engine_version: String,
    pub rule_pack_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub versions: Versions,
    pub opportunity_id: String,
    pub system_model: ControlSystem,
    pub evidence_coverage: Vec<DomainCoverage>,
    pub findings: Vec<Finding>,
    pub unknowns: Vec<Unknown>,
    pub dependencies: Vec<Dependency>,
    pub migration_paths: Vec<MigrationPath>,
    pub work_packages: Vec<WorkPackageRef>,
    pub candidate_bom: Vec<BomLine>,
    pub quote_readiness: QuoteReadiness,
    pub diagnostics: Vec<Diagnostic>,
}
