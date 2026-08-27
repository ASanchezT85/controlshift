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
        // A customer's first instinct is to send the native project file. That
        // must produce a BLOCKED finding with a way forward, not an I/O error.
        match read_source(&base.join(&a.path))? {
            Ok(text) => {
                let out = parser::parse(&a.path, &text);
                system = out.system;
                diagnostics = out.diagnostics;
            }
            Err(reason) => diagnostics.push(parser::Diagnostic {
                severity: "ERROR".into(),
                code: "E_SOURCE_NOT_TEXT".into(),
                message: reason,
                artifact: a.path.clone(),
                line: 0,
                column: 0,
            }),
        }
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

/// Outer Result: the file could not be opened. Inner Result: the file is not
/// the text export we analyze, and we say which file it looks like instead.
fn read_source(p: &Path) -> Result<Result<String, String>, String> {
    let bytes = std::fs::read(p).map_err(|e| format!("{}: {e}", p.display()))?;
    if bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) {
        return Ok(Err(
            "this is a native RSLogix 500 project (.RSS), not the ASCII export.              Re-export with File > Save As > Export Database > A.B. 6200 > .SLC,              Complete Program Save."
                .into(),
        ));
    }
    match String::from_utf8(bytes) {
        Ok(text) => Ok(Ok(text)),
        Err(_) => Ok(Err(
            "the supplied source is not text this parser can read; the ASCII export              is expected"
                .into(),
        )),
    }
}
