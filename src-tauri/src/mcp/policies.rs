use std::fs;
use std::path::{Component, Path, PathBuf};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::card::Card;
use super::tools::{explain_store, resolve_connection};
use crate::directory_from_connection;

const MAX_BYTES: u64 = 256 * 1024;
const MAX_DEPTH: usize = 2;
const UNKNOWN: &str = "Unknown policy. Call list_policies.";

#[derive(Debug, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PolicyInput {
    /// Relative POSIX path under policies/, such as README.md or pack/rules.md.
    pub name: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PolicyRow {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PoliciesBody {
    pub policies: Vec<PolicyRow>,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PolicyBody {
    pub id: String,
    pub title: String,
    pub markdown: String,
}

fn policies_root(store: Option<&serde_json::Value>) -> Result<PathBuf, String> {
    let connection = resolve_connection(store).map_err(explain_store)?;
    let directory = directory_from_connection(connection.value()).map_err(explain_store)?;
    Ok(directory.join("policies"))
}

pub(crate) fn list_policies_card(
    store: Option<&serde_json::Value>,
) -> Result<Card<PoliciesBody>, String> {
    let policies = list_policy_files(&policies_root(store)?)?;
    let display = if policies.is_empty() {
        "No policy Markdown files in the Settings folder.".to_string()
    } else {
        format!(
            "{} policy Markdown files in the Settings folder.",
            policies.len()
        )
    };
    Ok(Card::new(display, PoliciesBody { policies }))
}

pub(crate) fn get_policy_card(
    store: Option<&serde_json::Value>,
    input: PolicyInput,
) -> Result<Card<PolicyBody>, String> {
    let id = normalize_policy_id(&input.name)?;
    let markdown = read_policy_markdown(&policies_root(store)?, &id)?;
    let title = title_from_markdown(&markdown, &id);
    Ok(Card::new(
        markdown.clone(),
        PolicyBody {
            id,
            title,
            markdown,
        },
    ))
}

fn list_policy_files(root: &Path) -> Result<Vec<PolicyRow>, String> {
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut rows = Vec::new();
    collect_md(root, "", 1, &mut rows)?;
    rows.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(rows)
}

fn collect_md(
    dir: &Path,
    prefix: &str,
    depth: usize,
    rows: &mut Vec<PolicyRow>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if file_type.is_dir() {
            if depth < MAX_DEPTH {
                collect_md(&entry.path(), &posix_join(prefix, &name), depth + 1, rows)?;
            }
            continue;
        }
        if file_type.is_file() && name.ends_with(".md") {
            let id = posix_join(prefix, &name);
            let markdown = fs::read_to_string(entry.path()).unwrap_or_default();
            let title = title_from_markdown(&markdown, &id);
            rows.push(PolicyRow { id, title });
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

fn normalize_policy_id(name: &str) -> Result<String, String> {
    let name = name.trim().replace('\\', "/");
    if name.is_empty() || name.contains('\0') {
        return Err(UNKNOWN.into());
    }
    let path = Path::new(&name);
    if path.is_absolute() || path.has_root() {
        return Err(UNKNOWN.into());
    }
    let mut parts = Vec::new();
    for component in path.components() {
        let Component::Normal(part) = component else {
            return Err(UNKNOWN.into());
        };
        parts.push(part.to_string_lossy().into_owned());
    }
    if parts.is_empty()
        || parts.len() > MAX_DEPTH
        || !parts.last().is_some_and(|part| part.ends_with(".md"))
    {
        return Err(UNKNOWN.into());
    }
    Ok(parts.join("/"))
}

fn read_policy_markdown(root: &Path, id: &str) -> Result<String, String> {
    let root_canon = fs::canonicalize(root).map_err(|_| UNKNOWN.to_string())?;
    let file_canon = fs::canonicalize(root.join(id)).map_err(|_| UNKNOWN.to_string())?;
    if !file_canon.starts_with(&root_canon) {
        return Err(UNKNOWN.into());
    }
    let metadata = file_canon.metadata().map_err(|_| UNKNOWN.to_string())?;
    if !metadata.is_file() {
        return Err(UNKNOWN.into());
    }
    if metadata.len() > MAX_BYTES {
        return Err("Policy file is too large.".into());
    }
    fs::read_to_string(&file_canon).map_err(|_| UNKNOWN.to_string())
}

fn title_from_markdown(markdown: &str, id: &str) -> String {
    markdown
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .and_then(|line| line.strip_prefix("# "))
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            Path::new(id)
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| id.to_string())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::mcp::tools::{fixture_store, temp_dir};

    #[test]
    fn missing_policies_folder_lists_nothing() {
        let root = temp_dir("none");
        fs::write(root.join("main.bean"), "option \"title\" \"Ledger\"\n").unwrap();
        let store = fixture_store(&root, "local");
        let card = list_policies_card(Some(&store)).unwrap();
        assert!(card.body.policies.is_empty());
        assert!(!card.display_block.contains(root.to_str().unwrap()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn lists_two_levels_and_reads_by_relative_path() {
        let root = temp_dir("list");
        fs::create_dir_all(root.join("policies/pack")).unwrap();
        fs::write(
            root.join("policies/README.md"),
            "# Bookkeeping policies\n\nBase.\n",
        )
        .unwrap();
        fs::write(
            root.join("policies/pack/rules.md"),
            "# Pack rules\n\nExtra.\n",
        )
        .unwrap();
        fs::create_dir_all(root.join("policies/pack/deep")).unwrap();
        fs::write(root.join("policies/pack/deep/skip.md"), "# Skip\n").unwrap();
        let store = fixture_store(&root, "local");
        let card = list_policies_card(Some(&store)).unwrap();
        let ids: Vec<_> = card
            .body
            .policies
            .iter()
            .map(|row| row.id.as_str())
            .collect();
        assert_eq!(ids, ["README.md", "pack/rules.md"]);
        assert_eq!(card.body.policies[0].title, "Bookkeeping policies");

        let read = get_policy_card(
            Some(&store),
            PolicyInput {
                name: "pack/rules.md".into(),
            },
        )
        .unwrap();
        assert_eq!(read.body.id, "pack/rules.md");
        assert_eq!(read.body.title, "Pack rules");
        assert!(read.display_block.contains("Extra."));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_path_escape_and_non_markdown() {
        let root = temp_dir("escape");
        fs::create_dir_all(root.join("policies")).unwrap();
        fs::write(root.join("secret.md"), "# Secret\n").unwrap();
        fs::write(root.join("policies/ok.md"), "# Ok\n").unwrap();
        let store = fixture_store(&root, "local");
        for name in [
            "../secret.md",
            "/tmp/secret.md",
            "ok.txt",
            "rules.toml",
            "pack/deep/skip.md",
            "",
        ] {
            let err = get_policy_card(Some(&store), PolicyInput { name: name.into() })
                .err()
                .unwrap();
            assert!(err.contains("Unknown policy"), "{name}: {err}");
            assert!(!err.contains(root.to_str().unwrap()));
        }
        let _ = fs::remove_dir_all(&root);
    }
}
