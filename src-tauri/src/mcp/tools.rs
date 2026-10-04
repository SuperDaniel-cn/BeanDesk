use std::path::Path;
use std::process::Command;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::engine::resolve_engine;
use crate::ledger_init::{app_created_ledger, init_ledger_tree};
use crate::supervisor::accepts_local_origin;
use crate::{CONNECTION_KEY, directory_from_connection};

use super::card::Card;
use super::store::{connection_value, load_saved_connection};

const PREVIEW_LINES: usize = 12;
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
}

enum ResolvedConnection<'a> {
    Borrowed(&'a serde_json::Value),
    Owned(serde_json::Value),
}

impl ResolvedConnection<'_> {
    fn value(&self) -> &serde_json::Value {
        match self {
            Self::Borrowed(value) => value,
            Self::Owned(value) => value,
        }
    }
}

fn resolve_connection(store: Option<&serde_json::Value>) -> Result<ResolvedConnection<'_>, String> {
    match store {
        Some(value) if value.get(CONNECTION_KEY).is_some() => {
            Ok(ResolvedConnection::Borrowed(connection_value(value)?))
        }
        Some(value) => Ok(ResolvedConnection::Borrowed(value)),
        None => Ok(ResolvedConnection::Owned(load_saved_connection()?)),
    }
}

pub(crate) fn get_connection_card(
    store: Option<&serde_json::Value>,
) -> Result<Card<ConnectionBody>, String> {
    let resolved = match store {
        Some(value) => resolve_connection(Some(value))?,
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
    let origin = match active {
        "local" => connection
            .pointer("/local/origin")
            .and_then(|item| item.as_str()),
        "remote" => connection
            .pointer("/remote/origin")
            .and_then(|item| item.as_str()),
        _ => None,
    };
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
    let origin_kind = match origin {
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
    if !input.confirm_write {
        return Ok(Card::new(
            "Not written. Call again with confirmWrite true after the user agrees to create the first ledger in the Settings folder.",
            WriteBody {
                written: false,
                directory: directory.to_string_lossy().into_owned(),
            },
        ));
    }
    init_ledger_tree(&directory).map_err(explain_write)?;
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
    let display = if outcome.ok {
        "bean-check passed on the Settings folder.".to_string()
    } else {
        format!(
            "bean-check failed on the Settings folder (exit {}).",
            outcome.code
        )
    };
    Ok(Card::new(
        display,
        CheckBody {
            ok: outcome.ok,
            code: outcome.code,
            preview: outcome.preview,
            directory: directory.to_string_lossy().into_owned(),
        },
    ))
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

fn preview_output(text: &str) -> String {
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

fn sentences<const N: usize>(parts: [&str; N]) -> String {
    parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn explain_store(code: impl AsRef<str>) -> String {
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
        other => other.into(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::ledger_init::APP_MARKER;

    fn fixture_store(directory: impl Into<PathBuf>, active: &str) -> serde_json::Value {
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

    fn temp_dir(tag: &str) -> PathBuf {
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
    }

    #[test]
    fn init_ledger_writes_nothing_until_confirmed() {
        let root = temp_dir("pending");
        let store = fixture_store(&root, "local");
        let pending = init_ledger_card(
            Some(&store),
            InitLedgerInput {
                confirm_write: false,
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
            },
        )
        .unwrap();
        assert!(written.body.written);
        assert!(root.join("main.bean").is_file());
        assert!(root.join(APP_MARKER).is_file());
        assert!(!written.display_block.contains(root.to_str().unwrap()));

        let again = init_ledger_card(
            Some(&store),
            InitLedgerInput {
                confirm_write: true,
            },
        )
        .err()
        .unwrap();
        assert!(again.contains("already exists"));
        let _ = std::fs::remove_dir_all(&root);
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
}
