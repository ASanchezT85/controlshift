//! ControlShift deterministic analysis engine (MASTER SPEC 46).

pub mod engine;
pub mod ir;
pub mod lexer;
pub mod model;
pub mod parser;

use model::AnalysisRequest;
use std::path::Path;

/// Parse every supported artifact in the request and run the analysis.
pub fn analyze_request(
    req: &AnalysisRequest,
    pack: &engine::RulePack,
    base: &Path,
) -> Result<model::AnalysisResult, String> {
    let mut system = ir::ControlSystem {
        ir_schema_version: ir::IR_SCHEMA_VERSION.into(),
        ..Default::default()
    };
    let mut diagnostics = Vec::new();

    let sources: Vec<_> = req
        .artifacts
        .iter()
        .filter(|a| a.artifact_type == "PLC_SOURCE")
        .collect();
    if sources.len() > 1 {
        return Err("V1 analyzes one PLC_SOURCE per request".into());
    }
    if let Some(a) = sources.first() {
        let out = parser::parse(&a.path, &read(&base.join(&a.path))?);
        system = out.system;
        diagnostics = out.diagnostics;
    } else {
        diagnostics.push(parser::Diagnostic {
            severity: "ERROR".into(),
            code: "E_NO_PLC_SOURCE".into(),
            message: "no PLC_SOURCE artifact supplied; no system model can be reconstructed".into(),
            artifact: String::new(),
            line: 0,
            column: 0,
        });
    }

    Ok(engine::analyze(req, pack, system, diagnostics))
}

fn read(p: &Path) -> Result<String, String> {
    std::fs::read_to_string(p).map_err(|e| format!("{}: {e}", p.display()))
}
