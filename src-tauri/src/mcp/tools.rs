use std::path::Path;
use std::process::Command;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::directory_from_connection;
use crate::engine::resolve_engine;
use crate::ledger_init::{SKELETON_VERSION, init_ledger_tree, inspect_ledger, upgrade_ledger_tree};
use crate::policy_integrity::{Integrity, PolicyDb, PolicyStatus};
use crate::supervisor::accepts_local_origin;

use super::card::Card;
use super::copy::{self, CardLang};
use super::policy_lint::{PolicyLint, PolicyViolation, Severity};
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
    pub skeleton: String,
    pub skeleton_version: Option<u32>,
    pub locale: Option<String>,
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
pub(crate) struct UpgradeBody {
    pub written: bool,
    pub adopted: bool,
    pub directory: String,
    pub files: Vec<String>,
    pub version: u32,
    pub locale: String,
    pub warnings: Vec<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integrity: Option<Integrity>,
    pub baseline_drift: bool,
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

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpgradeLedgerInput {
    /// Set true after the user agrees to adopt or upgrade the Settings folder ledger. False returns a pending card and writes nothing.
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
    let inspect = directory
        .as_ref()
        .and_then(|path| inspect_ledger(path).ok());
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
        has_main_bean: inspect.as_ref().is_some_and(|item| item.has_main_bean),
        app_ledger: inspect.as_ref().is_some_and(|item| item.app_ledger),
        skeleton: inspect
            .as_ref()
            .map(|item| item.kind.clone())
            .unwrap_or_else(|| "none".into()),
        skeleton_version: inspect.as_ref().and_then(|item| item.version),
        locale: inspect.as_ref().and_then(|item| item.locale.clone()),
        origin_kind: origin_kind.into(),
        launch: launch.into(),
        directory: directory
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        has_policies_dir,
    };
    let lang = CardLang::from_tag(body.locale.as_deref().unwrap_or(""));
    let display = if directory.is_none() && body.active == "none" {
        copy::display_error(lang, "No connection saved in Settings.")
    } else {
        copy::connection_display(
            lang,
            body.has_local_directory,
            &body.skeleton,
            body.has_policies_dir,
            &body.active,
            &body.origin_kind,
            &body.launch,
        )
    };
    Ok(Card::new(display, body))
}

pub(crate) fn card_lang_from_connection(connection: &serde_json::Value) -> CardLang {
    CardLang::from_workdir(directory_from_connection(connection).ok().as_deref())
}

pub(crate) fn card_lang_from_store(store: Option<&serde_json::Value>) -> CardLang {
    match resolve_connection(store) {
        Ok(resolved) => card_lang_from_connection(resolved.value()),
        Err(_) => CardLang::En,
    }
}

pub(crate) fn init_ledger_card(
    store: Option<&serde_json::Value>,
    input: InitLedgerInput,
) -> Result<Card<WriteBody>, String> {
    let connection = resolve_connection(store).map_err(explain_store)?;
    let directory = directory_from_connection(connection.value()).map_err(explain_store)?;
    let locale = input.locale.trim();
    let lang = CardLang::from_tag(locale);
    if !input.confirm_write {
        crate::ledger_preset::preset(locale).map_err(explain_write)?;
        return Ok(Card::new(
            copy::init_pending(lang),
            WriteBody {
                written: false,
                directory: directory.to_string_lossy().into_owned(),
            },
        ));
    }
    init_ledger_tree(&directory, locale).map_err(explain_write)?;
    PolicyDb::seed_current(&directory, locale)?;
    Ok(Card::new(
        copy::init_written(lang),
        WriteBody {
            written: true,
            directory: directory.to_string_lossy().into_owned(),
        },
    ))
}

pub(crate) fn upgrade_ledger_card(
    store: Option<&serde_json::Value>,
    input: UpgradeLedgerInput,
) -> Result<Card<UpgradeBody>, String> {
    let connection = resolve_connection(store).map_err(explain_store)?;
    let directory = directory_from_connection(connection.value()).map_err(explain_store)?;
    let locale = input.locale.trim();
    let lang = CardLang::from_tag(locale);
    if !input.confirm_write {
        crate::ledger_preset::preset(locale).map_err(explain_write)?;
        let inspect = inspect_ledger(&directory).map_err(explain_write)?;
        if matches!(inspect.kind.as_str(), "empty" | "occupied") {
            return Err(explain_write("main-bean".into()));
        }
        return Ok(Card::new(
            copy::upgrade_pending(lang, &inspect.kind, locale),
            UpgradeBody {
                written: false,
                adopted: false,
                directory: directory.to_string_lossy().into_owned(),
                files: Vec::new(),
                version: SKELETON_VERSION,
                locale: locale.to_string(),
                warnings: Vec::new(),
            },
        ));
    }
    let report = upgrade_ledger_tree(&directory, locale).map_err(explain_write)?;
    PolicyDb::seed_current(&directory, locale)?;
    Ok(Card::new(
        copy::upgrade_written(
            lang,
            report.written.is_empty(),
            report.adopted,
            !report.warnings.is_empty(),
        ),
        UpgradeBody {
            written: !report.written.is_empty(),
            adopted: report.adopted,
            directory: directory.to_string_lossy().into_owned(),
            files: report.written,
            version: report.version,
            locale: report.locale,
            warnings: report.warnings,
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
    let db = PolicyDb::standard().ok();
    assemble_check_card_with(directory, outcome, db.as_ref())
}

fn assemble_check_card_with(
    directory: &Path,
    outcome: CheckOutcome,
    db: Option<&PolicyDb>,
) -> Card<CheckBody> {
    let directory_text = directory.to_string_lossy().into_owned();
    let lang = CardLang::from_workdir(Some(directory));
    if !outcome.ok {
        return Card::new(
            copy::bean_check_failed(lang, outcome.code),
            CheckBody {
                ok: false,
                code: outcome.code,
                preview: outcome.preview,
                directory: directory_text,
                policy_ok: None,
                violations: Vec::new(),
                integrity: None,
                baseline_drift: false,
            },
        );
    }
    let Some(db) = db else {
        let status = PolicyStatus {
            integrity: Integrity::Unseeded,
            baseline_drift: false,
            locale: None,
            review_reason: None,
            files: Vec::new(),
        };
        return check_body_card(
            directory_text,
            copy::check_passed_with_integrity(lang, &copy::integrity_sentence(lang, &status)),
            1,
            outcome.preview,
            false,
            Vec::new(),
            &status,
        );
    };
    let (status, lint) = db.review(directory);
    let sentence = copy::integrity_sentence(lang, &status);
    match lint {
        PolicyLint::LoadError(error) => {
            let preview = preview_output(&error);
            check_body_card(
                directory_text,
                copy::policy_load_failed(lang, &preview, &sentence),
                1,
                preview,
                false,
                Vec::new(),
                &status,
            )
        }
        PolicyLint::Checked(violations) => {
            let rule_ok = !violations
                .iter()
                .any(|item| item.severity == Severity::Error);
            let policy_ok = rule_ok && status.integrity == Integrity::Ok;
            let formatted = if violations.is_empty() {
                None
            } else {
                Some(preview_output(&format_violations(&violations)))
            };
            let preview = formatted.clone().unwrap_or_else(|| outcome.preview.clone());
            let display = if let Some(body) = formatted {
                copy::check_with_violations(lang, !rule_ok, &body, &sentence)
            } else {
                copy::check_passed_with_integrity(lang, &sentence)
            };
            check_body_card(
                directory_text,
                display,
                if policy_ok { outcome.code } else { 1 },
                preview,
                policy_ok,
                violations,
                &status,
            )
        }
    }
}

fn check_body_card(
    directory: String,
    display: String,
    code: i32,
    preview: String,
    policy_ok: bool,
    violations: Vec<PolicyViolation>,
    status: &PolicyStatus,
) -> Card<CheckBody> {
    Card::new(
        display.trim().to_string(),
        CheckBody {
            ok: policy_ok,
            code,
            preview,
            directory,
            policy_ok: Some(policy_ok),
            violations,
            integrity: Some(status.integrity),
            baseline_drift: status.baseline_drift,
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
        "main-bean" => "main.bean is missing in the Settings folder.".into(),
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
        assert!(pending.display_block.contains("尚未写入"));
        assert!(pending.display_block.contains("confirmWrite true"));
        assert!(pending.display_block.contains("中国大陆会计准则"));
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
        assert_eq!(connected.body.skeleton, "current");
        assert_eq!(connected.body.skeleton_version, Some(SKELETON_VERSION));
        assert_eq!(connected.body.locale.as_deref(), Some("zh-CN"));
        assert!(connected.display_block.contains("含 policies"));
        assert!(connected.display_block.contains("内置引擎"));
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
    fn upgrade_ledger_adopts_after_confirm() {
        let root = temp_dir("upgrade-adopt");
        std::fs::write(root.join("main.bean"), "option \"title\" \"Old\"\n").unwrap();
        std::fs::create_dir_all(root.join("data")).unwrap();
        std::fs::write(root.join("data/keep.bean"), "keep-entry\n").unwrap();
        let store = fixture_store(&root, "local");
        let pending = upgrade_ledger_card(
            Some(&store),
            UpgradeLedgerInput {
                confirm_write: false,
                locale: "en".into(),
            },
        )
        .unwrap();
        assert!(!pending.body.written);
        assert!(pending.display_block.contains("adopt"));
        assert!(!root.join(APP_MARKER).exists());

        let written = upgrade_ledger_card(
            Some(&store),
            UpgradeLedgerInput {
                confirm_write: true,
                locale: "en".into(),
            },
        )
        .unwrap();
        assert!(written.body.written);
        assert!(written.body.adopted);
        assert!(root.join(APP_MARKER).is_file());
        assert!(root.join("policies/base/chart-of-accounts.md").is_file());
        assert_eq!(
            std::fs::read_to_string(root.join("data/keep.bean")).unwrap(),
            "keep-entry\n"
        );
        assert!(!written.display_block.contains(root.to_str().unwrap()));
        let connected = get_connection_card(Some(&store)).unwrap();
        assert_eq!(connected.body.skeleton, "current");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn upgrade_ledger_requires_main_bean() {
        let root = temp_dir("upgrade-empty");
        let store = fixture_store(&root, "local");
        let err = upgrade_ledger_card(
            Some(&store),
            UpgradeLedgerInput {
                confirm_write: false,
                locale: "zh-CN".into(),
            },
        )
        .err()
        .unwrap();
        assert!(err.contains("main.bean is missing"));
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
        let db = PolicyDb::at(root.join("policy.json"));
        crate::ledger_init::write_marker(&root, "en").unwrap();
        db.seed_if_absent(&root, "en").unwrap();
        let card = assemble_check_card_with(&root, passed(), Some(&db));
        assert!(card.body.ok);
        assert_eq!(card.body.policy_ok, Some(true));
        assert_eq!(card.body.integrity, Some(Integrity::Ok));
        assert!(card.body.violations.is_empty());
        assert_eq!(card.display_block, "bean-check passed.");
        let json = serde_json::to_value(&card).unwrap();
        assert_eq!(json["integrity"], "ok");
        assert_eq!(json["violations"], serde_json::json!([]));
        assert!(!card.display_block.contains(root.to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn check_ledger_unseeded_fails_without_running_disk_custom() {
        let root = temp_dir("check-unseeded");
        std::fs::create_dir_all(root.join("policies")).unwrap();
        std::fs::write(
            root.join("policies/repay.toml"),
            r#"
[[rules]]
id = "repay-narration"
description = "Must not run before seeding."
severity = "error"
from = 2026-01-01
account = "Liabilities:Owner:Advance"
narration_regex = "还股东借款|还垫付款"
"#,
        )
        .unwrap();
        let db = PolicyDb::at(root.join("policy.json"));
        let card = assemble_check_card_with(&root, passed(), Some(&db));
        assert!(!card.body.ok);
        assert_eq!(card.body.integrity, Some(Integrity::Unseeded));
        assert!(card.body.violations.is_empty());
        assert!(card.display_block.contains("not seeded"));
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
        crate::ledger_init::write_marker(&root, "en").unwrap();
        let db = PolicyDb::at(root.join("policy.json"));
        db.seed_if_absent(&root, "en").unwrap();
        db.approve(&root).unwrap();
        let card = assemble_check_card_with(&root, passed(), Some(&db));
        assert!(!card.body.ok);
        assert_eq!(card.body.policy_ok, Some(false));
        assert_eq!(card.body.integrity, Some(Integrity::Ok));
        assert_eq!(card.body.violations.len(), 1);
        assert_eq!(card.body.violations[0].file, "data/2026/2026-03.bean");
        assert!(card.display_block.contains("Policy errors"));
        assert!(card.display_block.contains("repay-narration"));
        assert!(!card.display_block.contains(root.to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn get_connection_card_follows_the_ledger_locale() {
        let root = temp_dir("conn-zh");
        crate::ledger_init::write_marker(&root, "zh-CN").unwrap();
        let store = fixture_store(&root, "local");
        let card = get_connection_card(Some(&store)).unwrap();
        assert!(card.display_block.contains("已配置本机目录"));
        assert!(card.display_block.contains("内置引擎"));
        assert!(card.display_block.contains("本机回环"));
        assert!(!card.display_block.contains("Launch is"));
        assert!(!card.display_block.contains(root.to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn get_connection_card_stays_english_without_a_ready_pack() {
        let root = temp_dir("conn-jp");
        crate::ledger_init::write_marker(&root, "JP").unwrap();
        let store = fixture_store(&root, "local");
        let card = get_connection_card(Some(&store)).unwrap();
        assert!(card.display_block.contains("Using the local folder."));
        assert!(card.display_block.contains("bundled engine"));
        assert!(!card.display_block.contains("内置引擎"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn check_ledger_zh_cn_card_uses_chinese() {
        let root = temp_dir("check-zh");
        std::fs::create_dir_all(root.join("policies")).unwrap();
        std::fs::write(root.join("policies/README.md"), "# 财税策略\n").unwrap();
        let db = PolicyDb::at(root.join("policy.json"));
        crate::ledger_init::write_marker(&root, "zh-CN").unwrap();
        db.seed_if_absent(&root, "zh-CN").unwrap();
        let card = assemble_check_card_with(&root, passed(), Some(&db));
        assert!(card.body.ok);
        assert_eq!(card.display_block, "bean-check 已通过。");
        assert!(!card.display_block.contains(root.to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&root);
    }
}
