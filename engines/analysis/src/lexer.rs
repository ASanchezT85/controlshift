//! SLC ASCII lexer (MASTER SPEC 18). Line-oriented, see docs/slc-ascii-format.md.
//!
//! Never panics, never allocates unboundedly: one line at a time.

#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub text: String,
    pub column: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub number: usize,
    pub tokens: Vec<Token>,
    /// The line exactly as read, before comments and quoting were handled.
    pub raw: String,
}

/// Split a line into whitespace-separated tokens, keeping `"quoted strings"`
/// whole (quotes stripped) and dropping `;` comments.
pub fn tokenize_line(number: usize, src: &str) -> Line {
    let mut tokens = Vec::new();
    let bytes: Vec<char> = src.chars().collect();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if c == ';' {
            break;
        }
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        let text = if c == '"' {
            i += 1;
            let s = i;
            while i < bytes.len() && bytes[i] != '"' {
                i += 1;
            }
            let t: String = bytes[s..i].iter().collect();
            if i < bytes.len() {
                i += 1; // closing quote
            }
            t
        } else {
            while i < bytes.len() && !bytes[i].is_whitespace() {
                i += 1;
            }
            bytes[start..i].iter().collect()
        };
        tokens.push(Token {
            text,
            column: start + 1,
        });
    }
    Line {
        number,
        tokens,
        raw: src.to_string(),
    }
}

pub fn tokenize(src: &str) -> Vec<Line> {
    src.lines()
        .enumerate()
        .map(|(i, l)| tokenize_line(i + 1, l))
        .filter(|l| !l.tokens.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_comments_and_keeps_quoted_strings() {
        let l = tokenize_line(1, r#"  LADDER 2 "MAIN LINE" ; the main file"#);
        let t: Vec<&str> = l.tokens.iter().map(|t| t.text.as_str()).collect();
        assert_eq!(t, vec!["LADDER", "2", "MAIN LINE"]);
        assert_eq!(l.tokens[0].column, 3);
    }

    #[test]
    fn unterminated_quote_does_not_hang() {
        let l = tokenize_line(1, r#"PROJECT "oops"#);
        assert_eq!(l.tokens.len(), 2);
        assert_eq!(l.tokens[1].text, "oops");
    }

    #[test]
    fn blank_and_comment_only_lines_vanish() {
        assert!(tokenize("\n   \n; nothing here\n").is_empty());
    }
}
