use std::path::Path;
use std::process::Command;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::directory_from_connection;
use crate::engine::resolve_engine;
use crate::ledger_init::{app_created_ledger, write_ledger_tree};
use crate::supervisor::accepts_local_origin;

use super::card::Card;
use super::policy_lint::{lint_policies, PolicyLint, PolicyViolation, Severity};
use super::store::{connection_value, load_saved_connection};

pub(crate) const PREVIEW_LINES: usize = 12;
const PREVIEW_CHARS: usize = 160;

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionBody {
    pub active: String,
    pub has_local_directory: bool,
    pub has_main_bean: bool,
    pub app_ledger: bool,
    pub origin_kind: String,
    pub launch: String,
    pub directory: String,
    pub has_policies_dir: bool,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteBody {
    pub written: bool,
    pub directory: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckBody {
    pub ok: bool,
    pub code: i32,
    pub preview: String,
    pub directory: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy_ok: Option<bool>,
    pub violations: Vec<PolicyViolation>,
}

#[derive(Debug, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EmptyInput {}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InitLedgerInput {
    /// Set true after the user agrees to write the first ledger skeleton. False returns a pending card and writes nothing.
    #[serde(default)]
    pub confirm_write: bool,
    /// Required. Ready packs: zh-CN, en.
    pub locale: String,
}

pub(crate) enum ResolvedConnection<'a> {
    Borrowed(&'a serde_json::Value),
    Owned(serde_json::Value),
}

impl ResolvedConnection<'_> {
    pub(crate) fn value(&self) -> &serde_json::Value {
        match self {
            Self::Borrowed(value) => value,
            Self::Owned(value) => value,
        }
    }
}

pub(crate) fn resolve_connection(
    store: Option<&serde_json::Value>,
) -> Result<ResolvedConnection<'_>, String> {
    match store {
        Some(value) => Ok(ResolvedConnection::Borrowed(connection_value(value)?)),
        None => Ok(ResolvedConnection::Owned(load_saved_connection()?)),
    }
}

pub(crate) fn get_connection_card(
    store: Option<&serde_json::Value>,
) -> Result<Card<ConnectionBody>, String> {
    let resolved = match store {
        Some(_) => resolve_connection(store)?,
        None => ResolvedConnection::Owned(
            load_saved_connection().unwrap_or_else(|_| serde_json::json!({})),
        ),
    };
    let connection = resolved.value();
    let directory = directory_from_connection(connection).ok();
    let active = connection
        .get("active")
        .and_then(|item| item.as_str())
        .unwrap_or("none");
    let origin = active_origin(connection).ok();
    let launch = connection
        .pointer("/local/launch")
        .and_then(|item| item.as_str())
        .unwrap_or("");
    let launch = match launch {
        "engine" | "shell" => launch,
        _ if directory.is_some()
            && connection
                .pointer("/local/command")
                .and_then(|item| item.as_str())
                .unwrap_or("")
                .trim()
                .is_empty() =>
        {
            "engine"
        }
        _ if directory.is_some() => "shell",
        _ => "none",
    };
    let has_main = directory
        .as_ref()
        .is_some_and(|path| path.join("main.bean").is_file());
    let app_ledger = directory
        .as_ref()
        .is_some_and(|path| app_created_ledger(path));
    let has_policies_dir = directory
        .as_ref()
        .is_some_and(|path| path.join("policies").is_dir());
    let origin_kind = match origin.as_deref() {
        Some(value) if accepts_local_origin(value) => "loopback",
        Some(_) => "remote",
        None => "none",
    };
    let body = ConnectionBody {
        active: if matches!(active, "local" | "remote") {
            active.to_string()
        } else {
            "none".into()
        },
        has_local_directory: directory.is_some(),
        has_main_bean: has_main,
        app_ledger,
        origin_kind: origin_kind.into(),
        launch: launch.into(),
        directory: directory
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        has_policies_dir,
    };
    let display = if directory.is_none() && body.active == "none" {
        "No connection saved in Settings.".to_string()
    } else {
        sentences([
            if body.has_local_directory {
                "Settings has a local folder."
            } else {
                "Settings has no local folder."
            },
            if body.has_main_bean {
                "main.bean is present."
            } else {
                "main.bean is missing."
            },
            if body.app_ledger {
                "This is a BeanDesk-created ledger."
            } else if body.has_main_bean {
                "This folder already had a ledger."
            } else {
                ""
            },
            if body.has_policies_dir {
                "A policies folder is present."
            } else {
                ""
            },
            &format!(
                "Active mode is {}. Origin is {}. Launch is {}.",
                body.active, body.origin_kind, body.launch
            ),
        ])
    };
    Ok(Card::new(display, body))
}

pub(crate) fn init_ledger_card(
    store: Option<&serde_json::Value>,
    input: InitLedgerInput,
) -> Result<Card<WriteBody>, String> {
    let connection = resolve_connection(store).map_err(explain_store)?;
    let directory = directory_from_connection(connection.value()).map_err(explain_store)?;
    let pack = crate::ledger_preset::preset(input.locale.trim()).map_err(explain_write)?;
    if !input.confirm_write {
        return Ok(Card::new(
            "Not written. Call again with confirmWrite true after the user agrees to create the first ledger in the Settings folder.",
            WriteBody {
                written: false,
                directory: directory.to_string_lossy().into_owned(),
            },
        ));
    }
    write_ledger_tree(&directory, pack).map_err(explain_write)?;
    Ok(Card::new(
        "Created the first ledger skeleton in the Settings folder.",
        WriteBody {
            written: true,
            directory: directory.to_string_lossy().into_owned(),
        },
    ))
}

pub(crate) fn check_ledger_card(
    store: Option<&serde_json::Value>,
) -> Result<Card<CheckBody>, String> {
    let connection = resolve_connection(store).map_err(explain_store)?;
    let directory = directory_from_connection(connection.value()).map_err(explain_store)?;
    if !directory.join("main.bean").is_file() {
        return Err("main.bean is missing in the Settings folder.".into());
    }
    let outcome = run_check(&directory)?;
    Ok(assemble_check_card(&directory, outcome))
}

fn assemble_check_card(directory: &Path, outcome: CheckOutcome) -> Card<CheckBody> {
    let directory_text = directory.to_string_lossy().into_owned();
    if !outcome.ok {
        return Card::new(
            format!(
                "bean-check failed on the Settings folder (exit {}).",
                outcome.code
            ),
            CheckBody {
                ok: false,
                code: outcome.code,
                preview: outcome.preview,
                directory: directory_text,
                policy_ok: None,
                violations: Vec::new(),
            },
        );
    }
    match lint_policies(directory) {
        None => passed_check_card(directory_text, outcome, None),
        Some(PolicyLint::LoadError(error)) => {
            let preview = preview_output(&error);
            Card::new(
                format!(
                    "bean-check passed on the Settings folder. Policy rules could not be loaded.\n{preview}"
                ),
                CheckBody {
                    ok: false,
                    code: 1,
                    preview,
                    directory: directory_text,
                    policy_ok: Some(false),
                    violations: Vec::new(),
                },
            )
        }
        Some(PolicyLint::Checked(violations)) => {
            let policy_ok = !violations
                .iter()
                .any(|item| item.severity == Severity::Error);
            if policy_ok && violations.is_empty() {
                return passed_check_card(directory_text, outcome, Some(true));
            }
            let preview = preview_output(&format_violations(&violations));
            let label = if policy_ok { "warnings" } else { "errors" };
            Card::new(
                format!("bean-check passed on the Settings folder. Policy {label}:\n{preview}"),
                CheckBody {
                    ok: policy_ok,
                    code: if policy_ok { outcome.code } else { 1 },
                    preview,
                    directory: directory_text,
                    policy_ok: Some(policy_ok),
                    violations,
                },
            )
        }
    }
}

fn passed_check_card(
    directory: String,
    outcome: CheckOutcome,
    policy_ok: Option<bool>,
) -> Card<CheckBody> {
    Card::new(
        "bean-check passed on the Settings folder.".to_string(),
        CheckBody {
            ok: true,
            code: outcome.code,
            preview: outcome.preview,
            directory,
            policy_ok,
            violations: Vec::new(),
        },
    )
}

fn format_violations(violations: &[PolicyViolation]) -> String {
    violations
        .iter()
        .map(|item| {
            format!(
                "[{}] {}:{} {}",
                item.rule_id, item.file, item.line, item.message
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

struct CheckOutcome {
    ok: bool,
    code: i32,
    preview: String,
}

fn run_check(directory: &Path) -> Result<CheckOutcome, String> {
    let output = if let Ok(engine) = resolve_engine(None) {
        Command::new(engine)
            .args(["check", "main.bean"])
            .current_dir(directory)
            .output()
            .map_err(|error| format!("check: {error}"))?
    } else {
        Command::new("bean-check")
            .arg("main.bean")
            .current_dir(directory)
            .output()
            .map_err(|_| explain_store("missing-engine"))?
    };
    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    Ok(CheckOutcome {
        ok: output.status.success(),
        code: output.status.code().unwrap_or(-1),
        preview: preview_output(&text),
    })
}

pub(crate) fn preview_output(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(PREVIEW_LINES)
        .map(|line| {
            if line.chars().count() > PREVIEW_CHARS {
                format!("{}…", line.chars().take(PREVIEW_CHARS).collect::<String>())
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn active_origin(connection: &serde_json::Value) -> Result<String, String> {
    let origin = match connection.get("active").and_then(|item| item.as_str()) {
        Some("local") => connection
            .pointer("/local/origin")
            .and_then(|item| item.as_str()),
        Some("remote") => connection
            .pointer("/remote/origin")
            .and_then(|item| item.as_str()),
        _ => None,
    }
    .map(|origin| origin.trim().trim_end_matches('/'))
    .filter(|origin| !origin.is_empty())
    .ok_or_else(|| "No Fava origin in Settings.".to_string())?;
    Ok(origin.to_string())
}

fn sentences<const N: usize>(parts: [&str; N]) -> String {
    parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn explain_store(code: impl AsRef<str>) -> String {
    match code.as_ref() {
        "directory" => "No working directory in Settings.".into(),
        "missing" => "No connection saved in Settings.".into(),
        "missing-engine" => "No bundled engine and no bean-check on PATH.".into(),
        other => other.to_string(),
    }
}

fn explain_write(code: String) -> String {
    match code.as_str() {
        "directory" => explain_store("directory"),
        "ledger-exists" => "A ledger (main.bean) already exists in the Settings folder.".into(),
        "not-empty" => "The Settings folder is not empty.".into(),
        "missing-locale" => "locale is required. Use zh-CN or en.".into(),
        "missing-pack" => {
            "That ledger pack is reserved but not merged yet. Use zh-CN or en.".into()
        }
        "unsupported-locale" => "Unknown ledger locale. Use zh-CN or en.".into(),
        other => other.into(),
    }
}

#[cfg(test)]
pub(crate) fn temp_dir(tag: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "beandesk-mcp-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&path).unwrap();
    path
}

#[cfg(test)]
pub(crate) fn fixture_store(
    directory: impl Into<std::path::PathBuf>,
    active: &str,
) -> serde_json::Value {
    let directory = directory.into();
    serde_json::json!({
        "connection": {
            "active": active,
            "local": {
                "directory": directory.to_string_lossy(),
                "command": "",
                "origin": "http://127.0.0.1:5000",
                "launch": "engine"
            },
            "remote": null
        }
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::ledger_init::APP_MARKER;

    #[test]
    fn get_connection_keeps_the_path_off_the_card() {
        let path = PathBuf::from("/private/tmp/named-repo-must-not-appear");
        let store = fixture_store(&path, "local");
        let card = get_connection_card(Some(&store)).unwrap();
        assert!(!card.display_block.contains(path.to_str().unwrap()));
        assert_eq!(card.body.directory, path.to_string_lossy());
        assert_eq!(card.body.active, "local");
        assert_eq!(card.body.origin_kind, "loopback");
        assert_eq!(card.body.launch, "engine");
        assert!(card.body.has_local_directory);
        assert!(!card.body.has_policies_dir);
        assert!(!card.display_block.contains("policies"));
    }

    #[test]
    fn init_ledger_writes_nothing_until_confirmed() {
        let root = temp_dir("pending");
        let store = fixture_store(&root, "local");
        let pending = init_ledger_card(
            Some(&store),
            InitLedgerInput {
                confirm_write: false,
                locale: "zh-CN".into(),
            },
        )
        .unwrap();
        assert!(!pending.body.written);
        assert!(pending.display_block.contains("Not written"));
        assert!(!pending.display_block.contains(root.to_str().unwrap()));
        assert!(!root.join("main.bean").exists());

        let written = init_ledger_card(
            Some(&store),
            InitLedgerInput {
                confirm_write: true,
                locale: "zh-CN".into(),
            },
        )
        .unwrap();
        assert!(written.body.written);
        assert!(root.join("main.bean").is_file());
        assert!(root.join("config/commodities.bean").is_file());
        assert!(root.join(APP_MARKER).is_file());
        assert!(root.join("policies/README.md").is_file());
        assert!(!written.display_block.contains(root.to_str().unwrap()));
        let connected = get_connection_card(Some(&store)).unwrap();
        assert!(connected.body.has_policies_dir);
        assert!(connected
            .display_block
            .contains("A policies folder is present."));
        assert!(!connected.display_block.contains(root.to_str().unwrap()));

        let again = init_ledger_card(
            Some(&store),
            InitLedgerInput {
                confirm_write: true,
                locale: "zh-CN".into(),
            },
        )
        .err()
        .unwrap();
        assert!(again.contains("already exists"));
        assert!(root.join("policies/base/rules.toml").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn init_ledger_unknown_locale_writes_nothing() {
        let root = temp_dir("init-ar");
        let store = fixture_store(&root, "local");
        let err = init_ledger_card(
            Some(&store),
            InitLedgerInput {
                confirm_write: true,
                locale: "ar".into(),
            },
        )
        .err()
        .unwrap();
        assert!(err.contains("Unknown ledger locale"));
        assert!(!root.join("main.bean").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn init_ledger_requires_an_explicit_locale() {
        let root = temp_dir("init-locale");
        let store = fixture_store(&root, "local");
        let missing = init_ledger_card(
            Some(&store),
            InitLedgerInput {
                confirm_write: true,
                locale: String::new(),
            },
        )
        .err()
        .unwrap();
        assert!(missing.contains("locale is required"));
        let reserved = init_ledger_card(
            Some(&store),
            InitLedgerInput {
                confirm_write: false,
                locale: "JP".into(),
            },
        )
        .err()
        .unwrap();
        assert!(reserved.contains("reserved but not merged"));
        assert!(!root.join("main.bean").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn get_connection_treats_a_trailing_slash_origin_as_loopback() {
        let mut store = fixture_store("/private/tmp/named-repo-must-not-appear", "local");
        store["connection"]["local"]["origin"] = serde_json::json!("http://127.0.0.1:5000/");
        let card = get_connection_card(Some(&store)).unwrap();
        assert_eq!(card.body.origin_kind, "loopback");
    }

    #[test]
    fn check_ledger_needs_main_bean() {
        let root = temp_dir("check");
        let store = fixture_store(&root, "local");
        let err = check_ledger_card(Some(&store)).err().unwrap();
        assert!(err.contains("main.bean is missing"));
        assert!(!err.contains(root.to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn preview_output_keeps_a_short_summary() {
        let long = "x".repeat(200);
        let preview = preview_output(&format!("\n{long}\n\nok\n"));
        assert!(preview.starts_with('x'));
        assert!(preview.contains('…'));
        assert!(preview.contains("ok"));
        assert!(preview.lines().count() <= PREVIEW_LINES);
    }

    fn passed() -> CheckOutcome {
        CheckOutcome {
            ok: true,
            code: 0,
            preview: String::new(),
        }
    }

    #[test]
    fn check_ledger_without_toml_matches_syntax_only_card() {
        let root = temp_dir("check-notoml");
        std::fs::create_dir_all(root.join("policies")).unwrap();
        std::fs::write(root.join("policies/README.md"), "# Bookkeeping policies\n").unwrap();
        let card = assemble_check_card(&root, passed());
        assert!(card.body.ok);
        assert!(card.body.policy_ok.is_none());
        assert!(card.body.violations.is_empty());
        assert_eq!(
            card.display_block,
            "bean-check passed on the Settings folder."
        );
        let json = serde_json::to_value(&card).unwrap();
        assert!(json.get("policyOk").is_none());
        assert_eq!(json["violations"], serde_json::json!([]));
        assert!(!card.display_block.contains(root.to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn check_ledger_skips_policy_when_syntax_fails() {
        let root = temp_dir("check-syntax");
        std::fs::create_dir_all(root.join("policies")).unwrap();
        std::fs::write(
            root.join("policies/rules.toml"),
            r#"
[[rules]]
id = "need-tag"
description = "Must not run after a syntax failure."
severity = "error"
from = 2026-01-01
account = "Assets:Bank:*"
require_tag = "nope"
"#,
        )
        .unwrap();
        std::fs::create_dir_all(root.join("data/2026")).unwrap();
        std::fs::write(
            root.join("data/2026/2026-01.bean"),
            "2026-01-10 * \"Vendor\" \"Cloud\"\n  Expenses:Operations:Hosting   10.00 CNY\n  Assets:Bank:Checking        -10.00 CNY\n",
        )
        .unwrap();
        let card = assemble_check_card(
            &root,
            CheckOutcome {
                ok: false,
                code: 1,
                preview: "unbalanced".into(),
            },
        );
        assert!(!card.body.ok);
        assert!(card.body.policy_ok.is_none());
        assert!(card.body.violations.is_empty());
        assert!(card.display_block.contains("bean-check failed"));
        assert!(!card.display_block.contains("need-tag"));
        assert!(!card.display_block.contains(root.to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn check_ledger_fails_on_in_window_policy_errors() {
        let root = temp_dir("check-lint");
        std::fs::create_dir_all(root.join("policies")).unwrap();
        std::fs::write(
            root.join("policies/repay.toml"),
            r#"
[[rules]]
id = "repay-narration"
description = "Repayment narration must mention the shareholder loan."
severity = "error"
from = 2026-01-01
account = "Liabilities:Owner:Advance"
narration_regex = "还股东借款|还垫付款"
"#,
        )
        .unwrap();
        std::fs::create_dir_all(root.join("data/2025")).unwrap();
        std::fs::create_dir_all(root.join("data/2026")).unwrap();
        std::fs::write(
            root.join("data/2025/2025-12.bean"),
            "2025-12-15 * \"Owner\" \"转账\"\n  Liabilities:Owner:Advance    100.00 CNY\n  Assets:Bank:Checking       -100.00 CNY\n",
        )
        .unwrap();
        std::fs::write(
            root.join("data/2026/2026-03.bean"),
            "2026-03-15 * \"Owner\" \"转账\"\n  Liabilities:Owner:Advance    100.00 CNY\n  Assets:Bank:Checking       -100.00 CNY\n",
        )
        .unwrap();
        let card = assemble_check_card(&root, passed());
        assert!(!card.body.ok);
        assert_eq!(card.body.policy_ok, Some(false));
        assert_eq!(card.body.violations.len(), 1);
        assert_eq!(card.body.violations[0].file, "data/2026/2026-03.bean");
        assert!(card.display_block.contains("Policy errors"));
        assert!(card.display_block.contains("repay-narration"));
        assert!(!card.display_block.contains(root.to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&root);
    }
}
