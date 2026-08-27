//! Control Intermediate Representation (MASTER SPEC 19-20).
//!
//! Vendor opcode is preserved alongside the normalized one (SPEC 20).

use serde::{Deserialize, Serialize};

pub const IR_SCHEMA_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SourceSpan {
    pub artifact: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Module {
    pub slot: u8,
    pub catalog: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DataFile {
    pub designator: String,
    pub file_type: String,
    pub size: u32,
}

/// A parsed operand. `raw` is never destroyed - every classification is derived.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Operand {
    pub raw: String,
    /// File letter(s): `I`, `O`, `S`, `B3`, `N7`, `PD9`... `None` for immediates.
    pub file: Option<String>,
    pub indirect: bool,
    pub immediate: bool,
}

impl Operand {
    pub fn parse(raw: &str) -> Operand {
        let indirect = raw.contains('[');
        let immediate = raw
            .chars()
            .next()
            .map(|c| c.is_ascii_digit() || c == '-' || c == '.')
            .unwrap_or(false);
        let file = if immediate {
            None
        } else {
            // Take the designator up to the first ':', '/', '.' or '['.
            let end = raw.find([':', '/', '.', '[']).unwrap_or(raw.len());
            let d = raw[..end].trim_start_matches('#');
            if d.is_empty() {
                None
            } else {
                Some(d.to_string())
            }
        };
        Operand {
            raw: raw.to_string(),
            file,
            indirect,
            immediate,
        }
    }

    pub fn is_status(&self) -> bool {
        self.file.as_deref() == Some("S")
    }

    /// Slot number for a discrete/analog I/O operand (`I:6.0` -> 6).
    pub fn io_slot(&self) -> Option<u8> {
        match self.file.as_deref() {
            Some("I") | Some("O") => self.raw[2..]
                .split(['/', '.'])
                .next()
                .and_then(|s| s.parse().ok()),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Instruction {
    /// Exactly as written in the vendor artifact (SPEC 20: never destroyed).
    pub source_opcode: String,
    pub semantic_opcode: String,
    pub operands: Vec<Operand>,
    pub source_span: SourceSpan,
}

impl Instruction {
    /// Operands this instruction reads. Conservative: for anything we do not
    /// model explicitly, every operand counts as a read (never under-report).
    pub fn reads(&self) -> Vec<&Operand> {
        match self.source_opcode.as_str() {
            "OTE" | "OTL" | "OTU" => vec![],
            "MOV" | "COP" | "FLL" => self.operands.iter().take(1).collect(),
            _ => self.operands.iter().filter(|o| !o.immediate).collect(),
        }
    }

    /// Operands this instruction writes.
    pub fn writes(&self) -> Vec<&Operand> {
        match self.source_opcode.as_str() {
            "OTE" | "OTL" | "OTU" | "TON" | "TOF" | "RTO" | "CTU" | "CTD" => {
                self.operands.iter().take(1).collect()
            }
            "MOV" | "COP" | "FLL" => self.operands.iter().skip(1).take(1).collect(),
            "ADD" | "SUB" | "MUL" | "DIV" => self.operands.iter().skip(2).take(1).collect(),
            _ => vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Rung {
    pub index: usize,
    pub instructions: Vec<Instruction>,
    pub has_branch: bool,
    pub source_span: SourceSpan,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Program {
    pub number: u16,
    pub name: String,
    pub rungs: Vec<Rung>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Sti {
    pub program_file: u16,
    pub interval_ms: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ControlSystem {
    pub ir_schema_version: String,
    pub project: String,
    pub processor: String,
    pub processor_os: String,
    pub processor_series: String,
    pub chassis: String,
    pub modules: Vec<Module>,
    pub data_files: Vec<DataFile>,
    pub sti: Option<Sti>,
    pub programs: Vec<Program>,
}

impl ControlSystem {
    pub fn instructions(&self) -> impl Iterator<Item = &Instruction> {
        self.programs
            .iter()
            .flat_map(|p| p.rungs.iter())
            .flat_map(|r| r.instructions.iter())
    }

    pub fn rung_count(&self) -> usize {
        self.programs.iter().map(|p| p.rungs.len()).sum()
    }

    pub fn instruction_count(&self) -> usize {
        self.instructions().count()
    }

    pub fn count_opcode(&self, op: &str) -> usize {
        self.instructions()
            .filter(|i| i.source_opcode == op)
            .count()
    }

    pub fn operands(&self) -> impl Iterator<Item = &Operand> {
        self.instructions().flat_map(|i| i.operands.iter())
    }

    pub fn module_in_slot(&self, slot: u8) -> Option<&Module> {
        self.modules.iter().find(|m| m.slot == slot)
    }

    pub fn has_catalog(&self, catalog: &str) -> bool {
        self.modules.iter().any(|m| m.catalog == catalog)
    }
}
