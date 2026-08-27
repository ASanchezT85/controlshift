//! csanalyze - ControlShift deterministic analysis engine (MASTER SPEC 46).
//!
//!   csanalyze --request <request.json> [--out <result.json>]
//!
//! Reads only the artifacts named in the request. Never opens a network
//! connection, never writes to an input artifact (MASTER SPEC 8).

use csanalyze::{analyze_request, engine, model};

use model::AnalysisRequest;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

fn main() -> ExitCode {
    match run() {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("csanalyze: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<String, String> {
    let mut args = std::env::args().skip(1);
    let mut request: Option<PathBuf> = None;
    let mut out: Option<PathBuf> = None;
    let mut pack_dir = PathBuf::from("rulepacks/rockwell");
    while let Some(a) = args.next() {
        let mut val = || args.next().ok_or_else(|| format!("{a} needs a value"));
        match a.as_str() {
            "--request" => request = Some(val()?.into()),
            "--out" => out = Some(val()?.into()),
            "--rulepacks" => pack_dir = val()?.into(),
            "-h" | "--help" => {
                return Ok("usage: csanalyze --request <file> [--out <file>] [--rulepacks <dir>]"
                    .into())
            }
            other => return Err(format!("unknown argument `{other}`")),
        }
    }
    let request = request.ok_or("--request is required")?;
    let base = request.parent().unwrap_or(Path::new(".")).to_path_buf();

    let req: AnalysisRequest = serde_json::from_str(&read(&request)?)
        .map_err(|e| format!("invalid request: {e}"))?;
    let pack_path = pack_dir.join(format!("{}.json", req.rule_pack));
    let pack = engine::RulePack::load(&read(&pack_path)?)?;

    let result = analyze_request(&req, &pack, &base)?;
    let json = serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?;
    if let Some(p) = out {
        std::fs::write(&p, format!("{json}\n")).map_err(|e| format!("{}: {e}", p.display()))?;
        return Ok(format!("wrote {}", p.display()));
    }
    Ok(json)
}

fn read(p: &Path) -> Result<String, String> {
    std::fs::read_to_string(p).map_err(|e| format!("{}: {e}", p.display()))
}
