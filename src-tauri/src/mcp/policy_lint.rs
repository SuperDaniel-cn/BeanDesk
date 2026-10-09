use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use time::{Date, Month};

const MAX_BYTES: u64 = 256 * 1024;
const MAX_DEPTH: usize = 2;
const MAX_BEAN_DEPTH: usize = 4;
const MAX_BEAN_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum PostingSign {
    Positive,
    Negative,
}

impl PostingSign {
    fn as_str(self) -> &'static str {
        match self {
            Self::Positive => "positive",
            Self::Negative => "negative",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PolicyFile {
    rules: Vec<RawRule>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRule {
    id: String,
    description: String,
    severity: Severity,
    from: DateField,
    until: Option<DateField>,
    account: Option<String>,
    account_pattern: Option<String>,
    require_tag: Option<String>,
    require_payee: Option<bool>,
    narration_regex: Option<String>,
    posting_sign: Option<PostingSign>,
    forbidden_accounts: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum DateField {
    Text(String),
    Toml(toml::value::Datetime),
}

enum RuleAction {
    RequireTag { account: String, tag: String },
    RequirePayee { account: String },
    NarrationRegex { account: String, regex: Regex },
    PostingSign { account: String, sign: PostingSign },
    Forbidden(Vec<String>),
    AccountPattern(Regex),
}

struct Rule {
    id: String,
    description: String,
    severity: Severity,
    from: Date,
    until: Option<Date>,
    action: RuleAction,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PolicyViolation {
    pub file: String,
    pub line: usize,
    pub rule_id: String,
    pub message: String,
    pub severity: Severity,
}

#[derive(Debug)]
pub(crate) enum PolicyLint {
    LoadError(String),
    Checked(Vec<PolicyViolation>),
}

struct Txn {
    date: Date,
    file: String,
    line: usize,
    payee: String,
    narration: String,
    tags: Vec<String>,
    postings: Vec<Posting>,
}

struct Posting {
    line: usize,
    account: String,
    sign: Option<PostingSign>,
}

/// `None` when the work folder has no policy TOML (same as 0.2.1).
pub(crate) fn lint_policies(work_dir: &Path) -> Option<PolicyLint> {
    let files = match list_toml_files(&work_dir.join("policies")) {
        Ok(files) if files.is_empty() => return None,
        Ok(files) => files,
        Err(error) => return Some(PolicyLint::LoadError(error)),
    };
    match load_and_apply(work_dir, &files) {
        Ok(violations) => Some(PolicyLint::Checked(violations)),
        Err(error) => Some(PolicyLint::LoadError(error)),
    }
}

fn load_and_apply(
    work_dir: &Path,
    files: &[(String, PathBuf)],
) -> Result<Vec<PolicyViolation>, String> {
    let mut rules = Vec::new();
    for (id, path) in files {
        let parsed = load_toml_file(id, path)?;
        for (index, raw) in parsed.rules.into_iter().enumerate() {
            rules.push(compile_rule(id, index, raw)?);
        }
    }
    Ok(apply_rules(&rules, &scan_data_dir(work_dir)?))
}

fn list_toml_files(root: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    collect_toml(root, "", 1, &mut files)?;
    files.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(files)
}

fn collect_toml(
    dir: &Path,
    prefix: &str,
    depth: usize,
    files: &mut Vec<(String, PathBuf)>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        if file_type.is_dir() {
            if depth < MAX_DEPTH {
                collect_toml(&entry.path(), &posix_join(prefix, &name), depth + 1, files)?;
            }
            continue;
        }
        if file_type.is_file() && name.ends_with(".toml") {
            files.push((posix_join(prefix, &name), entry.path()));
        }
    }
    Ok(())
}

fn posix_join(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{prefix}/{name}")
    }
}

fn load_toml_file(label: &str, path: &Path) -> Result<PolicyFile, String> {
    let metadata = path
        .metadata()
        .map_err(|_| format!("{label}: could not read policy file."))?;
    if metadata.len() > MAX_BYTES {
        return Err(format!("{label}: Policy file is too large."));
    }
    let text =
        fs::read_to_string(path).map_err(|_| format!("{label}: could not read policy file."))?;
    toml::from_str(&text).map_err(|error| format!("{label}: {error}"))
}

fn compile_rule(file: &str, index: usize, raw: RawRule) -> Result<Rule, String> {
    let where_rule = format!("{file} rule {}", index + 1);
    let id = nonempty_text(&raw.id).ok_or_else(|| format!("{where_rule}: id is empty."))?;
    let description = nonempty_text(&raw.description)
        .ok_or_else(|| format!("{where_rule}: description is empty."))?;
    let from = date_field(&raw.from).map_err(|error| format!("{where_rule} from: {error}"))?;
    let until = raw
        .until
        .as_ref()
        .map(|value| date_field(value).map_err(|error| format!("{where_rule} until: {error}")))
        .transpose()?;
    if until.is_some_and(|end| end <= from) {
        return Err(format!(
            "{where_rule}: until must be after from (until is exclusive)."
        ));
    }
    if raw.require_payee == Some(false) {
        return Err(format!(
            "{where_rule}: require_payee must be true when set."
        ));
    }
    let account = raw.account.and_then(nonempty_text);
    let account_pattern = raw.account_pattern.and_then(nonempty_text);
    let action = match (
        raw.require_tag.and_then(nonempty_text),
        raw.require_payee,
        raw.narration_regex.and_then(nonempty_text),
        raw.posting_sign,
        raw.forbidden_accounts.map(|items| {
            items
                .into_iter()
                .filter_map(nonempty_text)
                .collect::<Vec<_>>()
        }),
        account_pattern,
        account,
    ) {
        (Some(tag), None, None, None, None, None, account) => RuleAction::RequireTag {
            account: require_account(&where_rule, account)?,
            tag,
        },
        (None, Some(true), None, None, None, None, account) => RuleAction::RequirePayee {
            account: require_account(&where_rule, account)?,
        },
        (None, None, Some(pattern), None, None, None, account) => RuleAction::NarrationRegex {
            account: require_account(&where_rule, account)?,
            regex: Regex::new(&pattern)
                .map_err(|error| format!("{where_rule}: invalid narration_regex ({error})"))?,
        },
        (None, None, None, Some(sign), None, None, account) => RuleAction::PostingSign {
            account: require_account(&where_rule, account)?,
            sign,
        },
        (None, None, None, None, Some(accounts), None, None) if !accounts.is_empty() => {
            RuleAction::Forbidden(accounts)
        }
        (None, None, None, None, Some(_), None, None) => {
            return Err(format!("{where_rule}: forbidden_accounts is empty."));
        }
        (None, None, None, None, Some(_), None, Some(_)) => {
            return Err(format!(
                "{where_rule}: forbidden_accounts cannot be combined with account."
            ));
        }
        (None, None, None, None, None, Some(pattern), None) => RuleAction::AccountPattern(
            Regex::new(&pattern)
                .map_err(|error| format!("{where_rule}: invalid account_pattern ({error})"))?,
        ),
        _ => {
            return Err(format!(
                "{where_rule}: set exactly one of require_tag, require_payee, narration_regex, posting_sign, forbidden_accounts, or account_pattern."
            ));
        }
    };
    Ok(Rule {
        id,
        description,
        severity: raw.severity,
        from,
        until,
        action,
    })
}

fn nonempty_text(value: impl AsRef<str>) -> Option<String> {
    let trimmed = value.as_ref().trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn require_account(where_rule: &str, account: Option<String>) -> Result<String, String> {
    account.ok_or_else(|| format!("{where_rule}: account is required for this action."))
}

fn date_field(field: &DateField) -> Result<Date, String> {
    match field {
        DateField::Text(text) => parse_iso_date(text),
        DateField::Toml(datetime) => date_from_datetime(datetime),
    }
}

fn parse_iso_date(text: &str) -> Result<Date, String> {
    let text = text.trim();
    let mut parts = text.split('-');
    let year = parts
        .next()
        .and_then(|part| part.parse::<i32>().ok())
        .ok_or_else(|| format!("expected YYYY-MM-DD, got {text}"))?;
    let month = parts
        .next()
        .and_then(|part| part.parse::<u8>().ok())
        .ok_or_else(|| format!("expected YYYY-MM-DD, got {text}"))?;
    let day = parts
        .next()
        .and_then(|part| part.parse::<u8>().ok())
        .ok_or_else(|| format!("expected YYYY-MM-DD, got {text}"))?;
    if parts.next().is_some() {
        return Err(format!("expected YYYY-MM-DD, got {text}"));
    }
    calendar_date(year, month, day)
}

fn date_from_datetime(datetime: &toml::value::Datetime) -> Result<Date, String> {
    let date = datetime
        .date
        .ok_or_else(|| "expected YYYY-MM-DD".to_string())?;
    if datetime.time.is_some() || datetime.offset.is_some() {
        return Err("expected a date without a time".into());
    }
    calendar_date(i32::from(date.year), date.month, date.day)
}

fn calendar_date(year: i32, month: u8, day: u8) -> Result<Date, String> {
    let month = Month::try_from(month).map_err(|error| error.to_string())?;
    Date::from_calendar_date(year, month, day).map_err(|error| error.to_string())
}

fn in_window(date: Date, rule: &Rule) -> bool {
    date >= rule.from && rule.until.is_none_or(|end| date < end)
}

fn apply_rules(rules: &[Rule], txns: &[Txn]) -> Vec<PolicyViolation> {
    let mut violations = Vec::new();
    for txn in txns {
        for rule in rules {
            if !in_window(txn.date, rule) {
                continue;
            }
            match &rule.action {
                RuleAction::RequireTag { account, tag } => {
                    if touches(txn, account) && !txn.tags.iter().any(|item| item == tag) {
                        violations.push(hit(
                            txn,
                            txn.line,
                            rule,
                            format!(
                                "posting matching {account} requires tag {tag}. {}",
                                rule.description
                            ),
                        ));
                    }
                }
                RuleAction::RequirePayee { account } => {
                    if touches(txn, account) && txn.payee.trim().is_empty() {
                        violations.push(hit(
                            txn,
                            txn.line,
                            rule,
                            format!(
                                "posting matching {account} requires a payee. {}",
                                rule.description
                            ),
                        ));
                    }
                }
                RuleAction::NarrationRegex { account, regex } => {
                    if touches(txn, account) && !regex.is_match(&txn.narration) {
                        violations.push(hit(
                            txn,
                            txn.line,
                            rule,
                            format!(
                                "posting matching {account} has a narration that does not match the rule. {}",
                                rule.description
                            ),
                        ));
                    }
                }
                RuleAction::PostingSign { account, sign } => {
                    for posting in &txn.postings {
                        if account_matches(account, &posting.account)
                            && posting.sign.is_some_and(|got| got != *sign)
                        {
                            violations.push(hit(
                                txn,
                                posting.line,
                                rule,
                                format!(
                                    "{} posting must be {}. {}",
                                    posting.account,
                                    sign.as_str(),
                                    rule.description
                                ),
                            ));
                        }
                    }
                }
                RuleAction::Forbidden(patterns) => {
                    for posting in &txn.postings {
                        if patterns
                            .iter()
                            .any(|pattern| account_matches(pattern, &posting.account))
                        {
                            violations.push(hit(
                                txn,
                                posting.line,
                                rule,
                                format!(
                                    "forbidden account {}. {}",
                                    posting.account, rule.description
                                ),
                            ));
                        }
                    }
                }
                RuleAction::AccountPattern(regex) => {
                    for posting in &txn.postings {
                        if !regex.is_match(&posting.account) {
                            violations.push(hit(
                                txn,
                                posting.line,
                                rule,
                                format!(
                                    "account {} does not match account_pattern. {}",
                                    posting.account, rule.description
                                ),
                            ));
                        }
                    }
                }
            }
        }
    }
    violations
}

fn touches(txn: &Txn, pattern: &str) -> bool {
    txn.postings
        .iter()
        .any(|item| account_matches(pattern, &item.account))
}

fn hit(txn: &Txn, line: usize, rule: &Rule, message: String) -> PolicyViolation {
    PolicyViolation {
        file: txn.file.clone(),
        line,
        rule_id: rule.id.clone(),
        message,
        severity: rule.severity,
    }
}

fn account_matches(pattern: &str, account: &str) -> bool {
    if pattern == account {
        return true;
    }
    if let Some(prefix) = pattern.strip_suffix(":*") {
        return account == prefix
            || (account.starts_with(prefix) && account[prefix.len()..].starts_with(':'));
    }
    pattern.contains('*') && match_components(&split_account(pattern), &split_account(account))
}

fn split_account(value: &str) -> Vec<&str> {
    value.split(':').collect()
}

fn match_components(pattern: &[&str], account: &[&str]) -> bool {
    match (pattern.split_first(), account.split_first()) {
        (None, None) => true,
        (Some((&"*", rest)), Some((_, rest_account))) => match_components(rest, rest_account),
        (Some((part, rest)), Some((got, rest_account))) if part == got => {
            match_components(rest, rest_account)
        }
        _ => false,
    }
}

fn scan_data_dir(work_dir: &Path) -> Result<Vec<Txn>, String> {
    let data = work_dir.join("data");
    if !data.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    collect_bean(&data, "data", 1, &mut files)?;
    files.sort_by(|left, right| left.0.cmp(&right.0));
    let mut txns = Vec::new();
    for (rel, path) in files {
        txns.extend(scan_bean_text(&rel, &read_bean_file(&rel, &path)?));
    }
    Ok(txns)
}

fn read_bean_file(rel: &str, path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|_| format!("{rel}: could not read ledger file."))?;
    if metadata.len() > MAX_BEAN_BYTES {
        return Err(format!("{rel}: ledger file is too large."));
    }
    fs::read_to_string(path).map_err(|_| format!("{rel}: could not read ledger file."))
}

fn collect_bean(
    dir: &Path,
    prefix: &str,
    depth: usize,
    files: &mut Vec<(String, PathBuf)>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        if file_type.is_dir() {
            if depth >= MAX_BEAN_DEPTH {
                return Err(format!(
                    "{}: ledger files are nested too deeply.",
                    posix_join(prefix, &name)
                ));
            }
            collect_bean(&entry.path(), &posix_join(prefix, &name), depth + 1, files)?;
            continue;
        }
        if file_type.is_file() && name.ends_with(".bean") {
            files.push((posix_join(prefix, &name), entry.path()));
        }
    }
    Ok(())
}

fn scan_bean_text(file: &str, text: &str) -> Vec<Txn> {
    let lines: Vec<&str> = text.lines().collect();
    let mut txns = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let line_no = index + 1;
        if let Some(header) = parse_txn_header(lines[index]) {
            index += 1;
            let mut postings = Vec::new();
            while index < lines.len() {
                let body = lines[index];
                if body.trim().is_empty() {
                    break;
                }
                if !body.starts_with(' ') && !body.starts_with('\t') {
                    break;
                }
                if let Some(posting) = parse_posting(body, index + 1) {
                    postings.push(posting);
                }
                index += 1;
            }
            txns.push(Txn {
                date: header.date,
                file: file.to_string(),
                line: line_no,
                payee: header.payee,
                narration: header.narration,
                tags: header.tags,
                postings,
            });
            continue;
        }
        index += 1;
    }
    txns
}

struct TxnHeader {
    date: Date,
    payee: String,
    narration: String,
    tags: Vec<String>,
}

fn parse_txn_header(line: &str) -> Option<TxnHeader> {
    let line = line.trim_end();
    if line.starts_with(';') {
        return None;
    }
    let mut parts = line.splitn(2, char::is_whitespace);
    let date = parse_iso_date(parts.next()?).ok()?;
    let rest = parts.next()?.trim_start();
    let rest = rest
        .strip_prefix("txn")
        .map(|item| item.trim_start())
        .unwrap_or(rest);
    let flag = rest.chars().next()?;
    if !matches!(flag, '*' | '!') {
        return None;
    }
    let rest = rest[flag.len_utf8()..].trim_start();
    let quoted = quoted_strings(rest);
    Some(TxnHeader {
        date,
        payee: quoted.first().cloned().unwrap_or_default(),
        narration: quoted.get(1).cloned().unwrap_or_default(),
        tags: parse_tags(rest),
    })
}

fn quoted_strings(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut inside = false;
    let mut buf = String::new();
    for ch in text.chars() {
        if ch == '"' {
            if inside {
                out.push(std::mem::take(&mut buf));
                inside = false;
            } else {
                inside = true;
            }
        } else if inside {
            buf.push(ch);
        }
    }
    out
}

fn parse_tags(text: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut inside = false;
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '"' {
            inside = !inside;
            index += 1;
            continue;
        }
        if !inside && chars[index] == '#' {
            index += 1;
            let start = index;
            while index < chars.len()
                && (chars[index].is_ascii_alphanumeric() || matches!(chars[index], '_' | '-' | '/'))
            {
                index += 1;
            }
            if index > start {
                tags.push(chars[start..index].iter().collect());
            }
            continue;
        }
        index += 1;
    }
    tags
}

fn parse_posting(line: &str, line_no: usize) -> Option<Posting> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with(';') {
        return None;
    }
    let rest = line.trim_start();
    let account_end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let account = &rest[..account_end];
    if !is_account(account) {
        return None;
    }
    let after = rest[account_end..].trim_start();
    Some(Posting {
        line: line_no,
        account: account.to_string(),
        sign: first_amount_sign(after),
    })
}

fn is_account(value: &str) -> bool {
    value.split(':').all(|part| {
        let mut chars = part.chars();
        matches!(chars.next(), Some(first) if first.is_ascii_uppercase())
            && chars.all(|ch| ch.is_alphanumeric() || ch == '-')
    })
}

fn first_amount_sign(rest: &str) -> Option<PostingSign> {
    let mut buf = String::new();
    let mut started = false;
    let mut negative = false;
    for ch in rest.chars() {
        if !started {
            if ch == '-' {
                negative = true;
                started = true;
                continue;
            }
            if ch.is_ascii_digit() {
                started = true;
                buf.push(ch);
                continue;
            }
            if ch == '{' || ch == '@' || ch == ';' {
                break;
            }
            continue;
        }
        if ch.is_ascii_digit() || ch == '.' || ch == ',' {
            buf.push(ch);
            continue;
        }
        break;
    }
    if !started || buf.is_empty() {
        return None;
    }
    let number: f64 = buf.replace(',', "").parse().ok()?;
    if number == 0.0 {
        return None;
    }
    if negative {
        Some(PostingSign::Negative)
    } else {
        Some(PostingSign::Positive)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "beandesk-policy-lint-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write(path: &Path, text: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, text).unwrap();
    }

    fn repay_rule() -> &'static str {
        r#"
[[rules]]
id = "repay-narration"
description = "Repayment narration must mention the shareholder loan."
severity = "error"
from = 2026-01-01
account = "Liabilities:Owner:Advance"
narration_regex = "还股东借款|还垫付款"
"#
    }

    fn txn(date: &str, narration: &str) -> String {
        format!(
            "{date} * \"Owner\" \"{narration}\"\n  Liabilities:Owner:Advance    100.00 CNY\n  Assets:Bank:Checking       -100.00 CNY\n"
        )
    }

    fn checked(root: &Path) -> Vec<PolicyViolation> {
        match lint_policies(root) {
            Some(PolicyLint::Checked(items)) => items,
            other => panic!("expected checked rules, got {other:?}"),
        }
    }

    #[test]
    fn missing_policies_or_readme_only_skips_lint() {
        let root = temp_dir("none");
        assert!(lint_policies(&root).is_none());
        write(&root.join("policies/README.md"), "# Bookkeeping policies\n");
        assert!(lint_policies(&root).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn date_window_ignores_older_postings() {
        let root = temp_dir("window");
        write(&root.join("policies/repay.toml"), repay_rule());
        write(
            &root.join("data/2025/2025-12.bean"),
            &txn("2025-12-15", "转账"),
        );
        write(
            &root.join("data/2026/2026-03.bean"),
            &txn("2026-03-15", "转账"),
        );
        let violations = checked(&root);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].rule_id, "repay-narration");
        assert_eq!(violations[0].file, "data/2026/2026-03.bean");
        assert_eq!(violations[0].severity, Severity::Error);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn matching_narration_in_window_passes() {
        let root = temp_dir("pass");
        write(&root.join("policies/repay.toml"), repay_rule());
        write(
            &root.join("data/2026/2026-03.bean"),
            &txn("2026-03-15", "还股东借款"),
        );
        assert!(checked(&root).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn until_is_exclusive() {
        let root = temp_dir("until");
        write(
            &root.join("policies/window.toml"),
            r#"
[[rules]]
id = "tag-rd"
description = "R&D postings need #rd."
severity = "error"
from = 2026-01-01
until = 2026-07-01
account = "Expenses:Operations:Hosting"
require_tag = "rd"
"#,
        );
        write(
            &root.join("data/2026/2026-06.bean"),
            "2026-06-30 * \"Vendor\" \"Cloud\"\n  Expenses:Operations:Hosting   10.00 CNY\n  Assets:Bank:Checking        -10.00 CNY\n",
        );
        write(
            &root.join("data/2026/2026-07.bean"),
            "2026-07-01 * \"Vendor\" \"Cloud\"\n  Expenses:Operations:Hosting   10.00 CNY\n  Assets:Bank:Checking        -10.00 CNY\n",
        );
        let violations = checked(&root);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].file, "data/2026/2026-06.bean");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn warning_does_not_fail_policy_ok() {
        let root = temp_dir("warn");
        write(
            &root.join("policies/payee.toml"),
            r#"
[[rules]]
id = "bank-payee"
description = "Bank postings should name a payee."
severity = "warning"
from = 2026-01-01
account = "Assets:Bank:*"
require_payee = true
"#,
        );
        write(
            &root.join("data/2026/2026-01.bean"),
            "2026-01-10 * \"\" \"Cash\"\n  Expenses:Operations:Hosting   10.00 CNY\n  Assets:Bank:Checking        -10.00 CNY\n",
        );
        let violations = checked(&root);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].severity, Severity::Warning);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn posting_sign_and_forbidden_accounts() {
        let root = temp_dir("sign");
        write(
            &root.join("policies/bank.toml"),
            r#"
[[rules]]
id = "bank-outflow"
description = "Bank payments are negative."
severity = "error"
from = 2026-01-01
account = "Assets:Bank:*"
posting_sign = "negative"

[[rules]]
id = "no-legacy"
description = "Do not post to the retired account."
severity = "error"
from = 2026-01-01
forbidden_accounts = ["Expenses:Legacy:Old"]
"#,
        );
        write(
            &root.join("data/2026/2026-02.bean"),
            "2026-02-01 * \"Vendor\" \"Buy\"\n  Expenses:Legacy:Old    10.00 CNY\n  Assets:Bank:Checking   10.00 CNY\n",
        );
        let ids: Vec<_> = checked(&root)
            .into_iter()
            .map(|item| item.rule_id)
            .collect();
        assert!(ids.iter().any(|id| id == "bank-outflow"));
        assert!(ids.iter().any(|id| id == "no-legacy"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_unknown_fields_and_does_not_read_escaped_paths() {
        let root = temp_dir("schema");
        write(
            &root.join("policies/bad.toml"),
            "version = 1\n[[rules]]\nid = \"x\"\n",
        );
        match lint_policies(&root) {
            Some(PolicyLint::LoadError(error)) => {
                assert!(
                    error.contains("unknown field") || error.contains("version"),
                    "{error}"
                );
            }
            other => panic!("expected a load error, got {other:?}"),
        }

        let outside = root.join("secret.toml");
        write(
            &outside,
            r#"
[[rules]]
id = "escaped"
description = "Should not run."
severity = "error"
from = 2026-01-01
account = "Assets:Bank:*"
require_tag = "nope"
"#,
        );
        write(
            &root.join("policies/pack/deep/hidden.toml"),
            r#"
[[rules]]
id = "deep"
description = "Too deep."
severity = "error"
from = 2026-01-01
account = "Assets:Bank:*"
require_tag = "nope"
"#,
        );
        write(&root.join("policies/ok.toml"), "rules = []\n");
        fs::remove_file(root.join("policies/bad.toml")).unwrap();
        write(
            &root.join("data/2026/2026-01.bean"),
            "2026-01-10 * \"Vendor\" \"Cloud\"\n  Expenses:Operations:Hosting   10.00 CNY\n  Assets:Bank:Checking        -10.00 CNY\n",
        );
        assert!(checked(&root).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn yaml_files_are_not_machine_rules() {
        let root = temp_dir("yaml");
        write(
            &root.join("policies/pack.yaml"),
            "rules:\n  - id: yaml-only\n",
        );
        assert!(lint_policies(&root).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn account_glob_matches_tree() {
        assert!(account_matches(
            "Expenses:Operations:RD:*",
            "Expenses:Operations:RD"
        ));
        assert!(account_matches(
            "Expenses:Operations:RD:*",
            "Expenses:Operations:RD:Staff"
        ));
        assert!(!account_matches(
            "Expenses:Operations:RD:*",
            "Expenses:Operations:Hosting"
        ));
        assert!(account_matches(
            "Assets:Bank:Checking",
            "Assets:Bank:Checking"
        ));
        assert!(!account_matches(
            "Assets:Bank:Checking",
            "Assets:Bank:Saving"
        ));
    }

    #[test]
    fn quoted_dates_parse() {
        let root = temp_dir("quoted");
        write(
            &root.join("policies/quoted.toml"),
            r#"
[[rules]]
id = "payee"
description = "Need a payee."
severity = "error"
from = "2026-01-01"
until = "2027-01-01"
account = "Assets:Bank:*"
require_payee = true
"#,
        );
        write(
            &root.join("data/2026/2026-01.bean"),
            "2026-01-10 * \"Vendor\" \"Cloud\" #ok\n  Expenses:Operations:Hosting   10.00 CNY\n  Assets:Bank:Checking        -10.00 CNY\n",
        );
        assert!(checked(&root).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn account_pattern_is_a_plain_regex() {
        let root = temp_dir("account-pattern");
        write(
            &root.join("policies/shape.toml"),
            r#"
[[rules]]
id = "assets-only"
description = "Postings must stay under Assets."
severity = "error"
from = "2026-01-01"
account_pattern = "^Assets:"
"#,
        );
        write(
            &root.join("data/2026/2026-01.bean"),
            "2026-01-10 * \"Vendor\" \"Mix\"\n  Expenses:Operations:Hosting   10.00 CNY\n  Assets:Bank:Checking        -10.00 CNY\n",
        );
        let violations = checked(&root);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].rule_id, "assets-only");
        assert_eq!(violations[0].line, 2);
        assert!(
            violations[0]
                .message
                .contains("Expenses:Operations:Hosting")
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn zh_cn_preset_pattern_accepts_hyphen_chinese_and_rejects_english() {
        let root = temp_dir("zh-preset");
        write(
            &root.join("policies/base/rules.toml"),
            include_str!("../ledger_presets/zh-CN/policies/base/rules.toml"),
        );
        write(
            &root.join("data/2026/2026-03.bean"),
            "2026-03-15 * \"Client\" \"Fee\"\n  Assets:Bank-银行存款:Main-XX银行对公户          50000.00 CNY\n  Income:Service-主营业务收入:Tech-软件定制开发  -50000.00 CNY\n",
        );
        assert!(checked(&root).is_empty());

        write(
            &root.join("data/2026/2026-03.bean"),
            "2026-03-15 * \"Client\" \"Fee\"\n  Assets:Bank:Checking    50000.00 CNY\n  Income:Sales           -50000.00 CNY\n",
        );
        let violations = checked(&root);
        assert_eq!(violations.len(), 2);
        assert!(
            violations
                .iter()
                .all(|item| item.rule_id == "localized-account-naming")
        );
        assert_eq!(violations[0].line, 2);
        assert!(violations[0].message.contains("Assets:Bank:Checking"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn account_pattern_cannot_mix_with_other_actions() {
        let root = temp_dir("account-pattern-mix");
        write(
            &root.join("policies/mix.toml"),
            r#"
[[rules]]
id = "mixed"
description = "Invalid combination."
severity = "error"
from = "2026-01-01"
account = "Assets:Bank:*"
account_pattern = "^Assets:"
"#,
        );
        match lint_policies(&root) {
            Some(PolicyLint::LoadError(error)) => {
                assert!(error.contains("exactly one of"), "{error}");
            }
            other => panic!("expected a load error, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn chinese_account_names_matched_by_rules() {
        assert!(is_account("Assets:Bank-银行存款:Main-XX银行对公户"));
        assert!(is_account("Expenses:Payroll-员工薪酬:Salary-研发基本工资"));
        assert!(account_matches(
            "Assets:Bank-银行存款:*",
            "Assets:Bank-银行存款:Main-XX银行对公户"
        ));

        let root = temp_dir("chinese-accounts");
        write(
            &root.join("policies/salary.toml"),
            r#"
[[rules]]
id = "rd-tag"
description = "研发薪酬必须附带 #rd 标签"
severity = "error"
from = "2026-01-01"
account = "Expenses:Payroll-员工薪酬:Salary-研发基本工资"
require_tag = "rd"
"#,
        );
        write(
            &root.join("data/2026/2026-01.bean"),
            r#"2026-01-15 * "XX公司" "发薪"
  Expenses:Payroll-员工薪酬:Salary-研发基本工资   8000.00 CNY
  Assets:Bank-银行存款:Main-XX银行对公户        -8000.00 CNY
"#,
        );
        let violations = checked(&root);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].rule_id, "rd-tag");
        assert_eq!(violations[0].line, 1);

        // Now with tag #rd, it passes
        write(
            &root.join("data/2026/2026-01.bean"),
            r#"2026-01-15 * "XX公司" "发薪" #rd
  Expenses:Payroll-员工薪酬:Salary-研发基本工资   8000.00 CNY
  Assets:Bank-银行存款:Main-XX银行对公户        -8000.00 CNY
"#,
        );
        assert!(checked(&root).is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn data_dir_rejects_deep_nests_and_huge_files() {
        let deep = temp_dir("deep-bean");
        let nested = deep.join("data/a/b/c/d/e");
        write(
            &nested.join("x.bean"),
            "2026-01-01 * \"a\" \"b\"\n  Assets:Cash  1 CNY\n  Equity:Open -1 CNY\n",
        );
        let err = match scan_data_dir(&deep) {
            Err(error) => error,
            Ok(_) => panic!("deep nests should fail"),
        };
        assert!(err.contains("nested too deeply"), "{err}");
        let _ = fs::remove_dir_all(&deep);

        let huge = temp_dir("huge-bean");
        let path = huge.join("data/2026/2026-01.bean");
        write(&path, "ok");
        fs::write(&path, vec![b'x'; (MAX_BEAN_BYTES as usize) + 1]).unwrap();
        let err = match scan_data_dir(&huge) {
            Err(error) => error,
            Ok(_) => panic!("huge files should fail"),
        };
        assert!(err.contains("too large"), "{err}");
        let _ = fs::remove_dir_all(&huge);
    }
}
