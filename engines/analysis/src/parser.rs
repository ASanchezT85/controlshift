//! SLC ASCII parser (MASTER SPEC 18). Deterministic, no LLM, never panics.
//! Malformed input yields diagnostics and parsing continues (SPEC 72).

use crate::ir::*;
use crate::lexer::{tokenize, Line};
use serde::{Deserialize, Serialize};

pub const PARSER_VERSION: &str = "1.0.0";

pub const STRUCTURAL: [&str; 5] = ["SOR", "EOR", "BST", "NXB", "BND"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Diagnostic {
    pub severity: String,
    pub code: String,
    pub message: String,
    pub artifact: String,
    pub line: usize,
    pub column: usize,
}

pub struct ParseOutput {
    pub system: ControlSystem,
    pub diagnostics: Vec<Diagnostic>,
}

struct Ctx {
    artifact: String,
    diags: Vec<Diagnostic>,
}

impl Ctx {
    fn warn(&mut self, code: &str, msg: String, line: usize, column: usize) {
        self.diags.push(Diagnostic {
            severity: "WARNING".into(),
            code: code.into(),
            message: msg,
            artifact: self.artifact.clone(),
            line,
            column,
        });
    }

    fn err(&mut self, code: &str, msg: String, line: usize, column: usize) {
        self.diags.push(Diagnostic {
            severity: "ERROR".into(),
            code: code.into(),
            message: msg,
            artifact: self.artifact.clone(),
            line,
            column,
        });
    }
}

fn num<T: std::str::FromStr>(ctx: &mut Ctx, l: &Line, idx: usize, what: &str) -> Option<T> {
    match l.tokens.get(idx) {
        None => {
            ctx.err(
                "E_MISSING_OPERAND",
                format!("missing {what}"),
                l.number,
                l.tokens.last().map(|t| t.column).unwrap_or(1),
            );
            None
        }
        Some(t) => match t.text.parse::<T>() {
            Ok(v) => Some(v),
            Err(_) => {
                ctx.err(
                    "E_BAD_NUMBER",
                    format!("{what} is not a number: {}", t.text),
                    l.number,
                    t.column,
                );
                None
            }
        },
    }
}

fn text(ctx: &mut Ctx, l: &Line, idx: usize, what: &str) -> Option<String> {
    match l.tokens.get(idx) {
        Some(t) => Some(t.text.clone()),
        None => {
            ctx.err("E_MISSING_OPERAND", format!("missing {what}"), l.number, 1);
            None
        }
    }
}

pub fn parse(artifact: &str, src: &str) -> ParseOutput {
    let mut ctx = Ctx {
        artifact: artifact.to_string(),
        diags: Vec::new(),
    };
    let mut sys = ControlSystem {
        ir_schema_version: IR_SCHEMA_VERSION.into(),
        ..Default::default()
    };
    let mut current: Option<Program> = None;

    for l in tokenize(src) {
        let kw = l.tokens[0].text.as_str();
        match kw {
            "IE" | "END_IO" | "END_DATAFILES" => {}
            "PROJECT" => sys.project = text(&mut ctx, &l, 1, "project name").unwrap_or_default(),
            "PROCESSOR" => {
                sys.processor = text(&mut ctx, &l, 1, "processor catalog").unwrap_or_default()
            }
            "PROCESSOR_OS" => sys.processor_os = text(&mut ctx, &l, 1, "OS").unwrap_or_default(),
            "PROCESSOR_SERIES" => {
                sys.processor_series = text(&mut ctx, &l, 1, "series").unwrap_or_default()
            }
            "CHASSIS" => sys.chassis = text(&mut ctx, &l, 1, "chassis").unwrap_or_default(),
            "SLOT" => {
                if let (Some(slot), Some(catalog)) = (
                    num::<u8>(&mut ctx, &l, 1, "slot number"),
                    text(&mut ctx, &l, 2, "slot catalog"),
                ) {
                    if sys.module_in_slot(slot).is_some() {
                        ctx.err(
                            "E_DUPLICATE_SLOT",
                            format!("slot {slot} declared twice"),
                            l.number,
                            l.tokens[1].column,
                        );
                    } else {
                        sys.modules.push(Module { slot, catalog });
                    }
                }
            }
            "DATAFILE" => {
                if let (Some(designator), Some(file_type), Some(size)) = (
                    text(&mut ctx, &l, 1, "data file designator"),
                    text(&mut ctx, &l, 2, "data file type"),
                    num::<u32>(&mut ctx, &l, 3, "data file size"),
                ) {
                    sys.data_files.push(DataFile {
                        designator,
                        file_type,
                        size,
                    });
                }
            }
            "STI_FILE" => {
                if let (Some(program_file), Some(interval_ms)) = (
                    num::<u16>(&mut ctx, &l, 1, "STI program file"),
                    num::<u32>(&mut ctx, &l, 2, "STI interval"),
                ) {
                    sys.sti = Some(Sti {
                        program_file,
                        interval_ms,
                    });
                }
            }
            "LADDER" => {
                if let Some(p) = current.take() {
                    ctx.err(
                        "E_UNCLOSED_LADDER",
                        format!("ladder {} not closed by END_LADDER", p.number),
                        l.number,
                        1,
                    );
                    sys.programs.push(p);
                }
                if let Some(number) = num::<u16>(&mut ctx, &l, 1, "ladder number") {
                    let name = l
                        .tokens
                        .get(2)
                        .map(|t| t.text.clone())
                        .unwrap_or_else(|| format!("LAD{number}"));
                    current = Some(Program {
                        number,
                        name,
                        rungs: Vec::new(),
                    });
                }
            }
            "END_LADDER" => match current.take() {
                Some(p) => sys.programs.push(p),
                None => ctx.err(
                    "E_STRAY_END_LADDER",
                    "END_LADDER outside a ladder".into(),
                    l.number,
                    1,
                ),
            },
            "SOR" => {
                if current.is_none() {
                    // Keep the rung. The SOR..EOR layer is the part of the
                    // format that is confirmed; an unrecognised container is
                    // no reason to drop the logic inside it.
                    ctx.warn(
                        "W_RUNG_OUTSIDE_LADDER",
                        "rung found outside any recognised program block;                          attributed to UNATTRIBUTED"
                            .into(),
                        l.number,
                        1,
                    );
                    current = Some(Program {
                        number: 0,
                        name: "UNATTRIBUTED".into(),
                        rungs: Vec::new(),
                    });
                }
                let prog = current.as_mut().expect("just created");
                let index = prog.rungs.len();
                let (rung, mut d) = parse_rung(&ctx.artifact, &l, index, l.raw.trim());
                ctx.diags.append(&mut d);
                prog.rungs.push(rung);
            }
            other => ctx.err(
                "E_UNKNOWN_KEYWORD",
                format!("unrecognized keyword `{other}`"),
                l.number,
                l.tokens[0].column,
            ),
        }
    }

    if let Some(p) = current.take() {
        ctx.err(
            "E_UNCLOSED_LADDER",
            format!("ladder {} not closed by END_LADDER", p.number),
            p.rungs.last().map(|r| r.source_span.line).unwrap_or(0),
            1,
        );
        sys.programs.push(p);
    }

    ParseOutput {
        system: sys,
        diagnostics: ctx.diags,
    }
}

/// A rung line: `SOR <mnemonic> [operands...] ... EOR`.
///
/// Mnemonics are ALL-CAPS alphabetic tokens; anything else is an operand of the
/// mnemonic that precedes it. That is the whole disambiguation rule and it is
/// why operands like `T4:0/DN` (not purely alphabetic) never look like opcodes.
fn parse_rung(
    artifact: &str,
    l: &Line,
    index: usize,
    source_text: &str,
) -> (Rung, Vec<Diagnostic>) {
    let mut diags = Vec::new();
    let span = SourceSpan {
        artifact: artifact.to_string(),
        line: l.number,
    };
    let mut instructions: Vec<Instruction> = Vec::new();
    let mut has_branch = false;
    let mut closed = false;

    for t in l.tokens.iter().skip(1) {
        let s = t.text.as_str();
        if s == "EOR" {
            closed = true;
            continue;
        }
        if closed {
            diags.push(Diagnostic {
                severity: "ERROR".into(),
                code: "E_TOKEN_AFTER_EOR".into(),
                message: format!("token `{s}` after EOR"),
                artifact: artifact.to_string(),
                line: l.number,
                column: t.column,
            });
            continue;
        }
        if STRUCTURAL.contains(&s) {
            has_branch = true;
            continue;
        }
        if is_mnemonic(s) {
            instructions.push(Instruction {
                source_opcode: s.to_string(),
                semantic_opcode: semantic(s).to_string(),
                operands: Vec::new(),
                source_span: span.clone(),
            });
        } else if let Some(last) = instructions.last_mut() {
            last.operands.push(Operand::parse(s));
        } else {
            diags.push(Diagnostic {
                severity: "ERROR".into(),
                code: "E_OPERAND_WITHOUT_INSTRUCTION".into(),
                message: format!("operand `{s}` with no preceding instruction"),
                artifact: artifact.to_string(),
                line: l.number,
                column: t.column,
            });
        }
    }

    if !closed {
        diags.push(Diagnostic {
            severity: "ERROR".into(),
            code: "E_UNTERMINATED_RUNG".into(),
            message: "rung not terminated by EOR".into(),
            artifact: artifact.to_string(),
            line: l.number,
            column: 1,
        });
    }

    (
        Rung {
            index,
            instructions,
            has_branch,
            source_text: source_text.to_string(),
            source_span: span,
        },
        diags,
    )
}

fn is_mnemonic(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 4
        && s.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        && s.chars().next().is_some_and(|c| c.is_ascii_uppercase())
}

/// Normalized opcode (SPEC 20). The vendor opcode is kept verbatim alongside;
/// anything not explicitly normalized keeps its own spelling rather than being
/// mapped to a guess.
fn semantic(op: &str) -> &str {
    match op {
        "XIC" => "CONTACT_NO",
        "XIO" => "CONTACT_NC",
        "OTE" => "COIL",
        "OTL" => "COIL_LATCH",
        "OTU" => "COIL_UNLATCH",
        "TON" => "TIMER_ON_DELAY",
        "TOF" => "TIMER_OFF_DELAY",
        "RTO" => "TIMER_RETENTIVE",
        "CTU" => "COUNTER_UP",
        "CTD" => "COUNTER_DOWN",
        "MOV" => "MOVE",
        "ADD" => "ADD",
        "SUB" => "SUBTRACT",
        "MUL" => "MULTIPLY",
        "DIV" => "DIVIDE",
        "PID" => "PID",
        "MSG" => "MESSAGE",
        "IIM" => "IMMEDIATE_INPUT",
        "IOM" => "IMMEDIATE_OUTPUT",
        "JSR" => "SUBROUTINE_CALL",
        "SBR" => "SUBROUTINE_ENTRY",
        "RET" => "SUBROUTINE_RETURN",
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sys(src: &str) -> ParseOutput {
        parse("t.SLC", src)
    }

    #[test]
    fn parses_header_and_rack() {
        let o = sys("PROCESSOR 1747-L553\nSLOT 0 1747-L553\nSLOT 8 1747-SDN\nEND_IO\n");
        assert_eq!(o.system.processor, "1747-L553");
        assert!(o.system.has_catalog("1747-SDN"));
        assert!(o.diagnostics.is_empty());
    }

    #[test]
    fn structural_tokens_are_not_instructions() {
        let o =
            sys("LADDER 2 \"M\"\nSOR BST XIC I:1/0 NXB XIC I:1/1 BND OTE O:4/0 EOR\nEND_LADDER\n");
        let r = &o.system.programs[0].rungs[0];
        assert_eq!(r.instructions.len(), 3);
        assert!(r.has_branch);
    }

    #[test]
    fn indirect_and_status_operands_are_classified() {
        let o = sys("LADDER 2 \"M\"\nSOR XIC B3[N7:10]/0 MOV S:4 N7:20 EOR\nEND_LADDER\n");
        let ops: Vec<&Operand> = o.system.operands().collect();
        assert!(ops[0].indirect);
        assert!(ops[1].is_status());
        assert!(!ops[0].is_status());
    }

    #[test]
    fn a_foreign_header_does_not_delete_the_program() {
        // The public record confirms SOR..EOR and BST/NXB/BND; it does not
        // confirm our header spelling. A header we cannot read must cost us
        // the header, never the logic.
        let o = sys("*** UNKNOWN VENDOR HEADER ***
PROC_TYPE=1747-L553
$SLOT 00 1747-L553
             LADDER FILE 2
SOR XIC I:1/0 OTE O:4/0 EOR
SOR IIM I:1.0 1 EOR
");
        assert_eq!(
            o.system.rung_count(),
            2,
            "rungs must survive an unreadable header"
        );
        assert_eq!(
            o.system.count_opcode("IIM"),
            1,
            "the IIM must still be found"
        );
        assert!(o
            .diagnostics
            .iter()
            .any(|d| d.code == "W_RUNG_OUTSIDE_LADDER"));
    }

    #[test]
    fn malformed_input_diagnoses_instead_of_crashing() {
        let o = sys("SLOT abc 1746-IB16\nSOR XIC I:1/0\nEND_LADDER\nWAT\n");
        let codes: Vec<&str> = o.diagnostics.iter().map(|d| d.code.as_str()).collect();
        assert!(codes.contains(&"E_BAD_NUMBER"));
        assert!(codes.contains(&"E_UNKNOWN_KEYWORD"));
        assert!(codes.contains(&"E_UNTERMINATED_RUNG"));
        // The orphan rung opens an UNATTRIBUTED program, so the END_LADDER that
        // follows closes it legitimately rather than reading as stray.
        assert!(codes.contains(&"W_RUNG_OUTSIDE_LADDER"));
        assert_eq!(o.system.rung_count(), 1, "the rung is kept, not discarded");
    }

    #[test]
    fn unterminated_rung_is_reported_but_kept() {
        let o = sys("LADDER 2 \"M\"\nSOR XIC I:1/0 OTE O:4/0\nEND_LADDER\n");
        assert_eq!(o.system.programs[0].rungs[0].instructions.len(), 2);
        assert_eq!(o.diagnostics[0].code, "E_UNTERMINATED_RUNG");
    }

    #[test]
    fn a_genuinely_stray_end_ladder_is_still_reported() {
        let o = sys("END_LADDER
");
        assert_eq!(o.diagnostics[0].code, "E_STRAY_END_LADDER");
    }

    #[test]
    fn garbage_bytes_do_not_panic() {
        for src in [
            "\u{0}\u{1}\u{2}",
            "SOR EOR",
            "LADDER",
            "DATAFILE N7",
            "SOR I:1/0 EOR",
            &"SOR ".repeat(5000),
        ] {
            let _ = sys(src);
        }
    }
}
