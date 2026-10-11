use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::ledger_preset::{LedgerPreset, preset};

pub const SKELETON_VERSION: u32 = 3;
pub const APP_MARKER: &str = ".beandesk";
pub const BACKUP_GITIGNORE: &str = "\
.backup_key
.backup_key.new
.env
backups/
.DS_Store
";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LedgerMarker {
    version: u32,
    #[serde(default)]
    locale: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerInspect {
    pub kind: String,
    pub version: Option<u32>,
    pub locale: Option<String>,
    pub has_main_bean: bool,
    pub app_ledger: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeReport {
    pub adopted: bool,
    pub written: Vec<String>,
    pub version: u32,
    pub locale: String,
    pub warnings: Vec<String>,
}

pub fn init_ledger_tree(directory: &Path, locale: &str) -> Result<(), String> {
    let pack = preset(locale)?;
    if !directory.is_absolute() || !directory.is_dir() {
        return Err("directory".to_string());
    }
    if directory.join("main.bean").exists() {
        return Err("ledger-exists".to_string());
    }
    if !effectively_empty(directory)? {
        return Err("not-empty".to_string());
    }

    let extra_roots = ["config", "data", "documents", "policies"].map(|name| directory.join(name));
    let mut created = Vec::new();
    let result = write_new_ledger(directory, locale, &pack, &mut created);
    if result.is_err() {
        revert_created(&created, &extra_roots);
    }
    result
}

fn write_new_ledger(
    directory: &Path,
    locale: &str,
    pack: &LedgerPreset,
    created: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    let year = now.year();
    let month = u8::from(now.month());
    let year_dir = directory.join("data").join(year.to_string());
    fs::create_dir_all(directory.join("config")).map_err(|error| error.to_string())?;
    fs::create_dir_all(&year_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(directory.join("documents")).map_err(|error| error.to_string())?;
    fs::create_dir_all(directory.join("policies/base")).map_err(|error| error.to_string())?;

    let month_file = format!("{year}-{month:02}.bean");
    let main = format!(
        "option \"title\" \"Ledger\"\n\
         option \"operating_currency\" \"{}\"\n\
         option \"documents\" \"documents\"\n\
         include \"config/commodities.bean\"\n\
         include \"config/accounts.bean\"\n\
         include \"data/{year}/{year}.bean\"\n",
        pack.operating_currency
    );
    let year_index = format!("include \"{month_file}\"\n");

    write_new_tracked(
        created,
        directory.join("config/commodities.bean"),
        pack.commodities,
    )?;
    write_new_tracked(
        created,
        directory.join("config/accounts.bean"),
        pack.accounts,
    )?;
    write_new_tracked(created, year_dir.join(format!("{year}.bean")), &year_index)?;
    write_new_tracked(created, year_dir.join(&month_file), "")?;
    write_new_tracked(created, directory.join(".gitignore"), BACKUP_GITIGNORE)?;
    for (rel, contents) in baseline_files(pack) {
        write_new_tracked(created, directory.join(rel), contents)?;
    }
    created.push(directory.join(APP_MARKER));
    write_marker(directory, locale.trim())?;
    write_new_tracked(created, directory.join("main.bean"), &main)?;
    Ok(())
}

fn write_new_tracked(
    created: &mut Vec<PathBuf>,
    path: PathBuf,
    contents: &str,
) -> Result<(), String> {
    write_new(&path, contents)?;
    created.push(path);
    Ok(())
}

fn revert_created(files: &[PathBuf], roots: &[PathBuf]) {
    for path in files.iter().rev() {
        let _ = fs::remove_file(path);
    }
    for root in roots.iter().rev() {
        let _ = fs::remove_dir_all(root);
    }
}

pub fn inspect_ledger(directory: &Path) -> Result<LedgerInspect, String> {
    if !directory.is_absolute() || !directory.is_dir() {
        return Err("directory".to_string());
    }
    let has_main_bean = directory.join("main.bean").is_file();
    let app_ledger = app_created_ledger(directory);
    let marker = read_marker(directory);
    let version = marker.as_ref().map(|marker| marker.version);
    let locale = marker.as_ref().and_then(|marker| {
        let id = marker.locale.trim();
        if id.is_empty() {
            None
        } else {
            Some(id.to_string())
        }
    });
    let kind = if !has_main_bean {
        if effectively_empty(directory)? {
            "empty"
        } else {
            "occupied"
        }
    } else if !app_ledger {
        "foreign"
    } else if needs_upgrade(directory, version, locale.as_deref()) {
        "outdated"
    } else {
        "current"
    };
    Ok(LedgerInspect {
        kind: kind.into(),
        version,
        locale,
        has_main_bean,
        app_ledger,
    })
}

pub fn upgrade_ledger_tree(directory: &Path, locale: &str) -> Result<UpgradeReport, String> {
    if !directory.is_absolute() || !directory.is_dir() {
        return Err("directory".to_string());
    }
    if !directory.join("main.bean").is_file() {
        return Err("main-bean".to_string());
    }
    let pack = preset(locale)?;
    let inspect = inspect_ledger(directory)?;
    if inspect.kind == "current" {
        return Ok(UpgradeReport {
            adopted: false,
            written: Vec::new(),
            version: SKELETON_VERSION,
            locale: inspect.locale.unwrap_or_else(|| locale.to_string()),
            warnings: Vec::new(),
        });
    }
    let adopted = inspect.kind == "foreign";
    let before = crate::backup::git_snapshot(directory).is_err();
    let mut written = sync_baseline(directory, pack)?;
    write_marker(directory, locale)?;
    written.push(APP_MARKER.to_string());
    let after = crate::backup::git_snapshot(directory).is_err();
    let warnings = if before || after {
        vec!["git-snapshot".to_string()]
    } else {
        Vec::new()
    };
    Ok(UpgradeReport {
        adopted,
        written,
        version: SKELETON_VERSION,
        locale: locale.to_string(),
        warnings,
    })
}

pub fn app_created_ledger(directory: &Path) -> bool {
    directory.join(APP_MARKER).is_file()
}

pub fn ensure_backup_gitignore(directory: &Path) -> Result<bool, String> {
    let path = directory.join(".gitignore");
    let current = if path.is_file() {
        fs::read_to_string(&path).map_err(|error| error.to_string())?
    } else {
        write_new(&path, BACKUP_GITIGNORE)?;
        return Ok(true);
    };
    let missing = gitignore_missing_lines(&current);
    if missing.is_empty() {
        return Ok(false);
    }
    let mut next = current;
    if !next.ends_with('\n') && !next.is_empty() {
        next.push('\n');
    }
    for line in missing {
        next.push_str(line);
        next.push('\n');
    }
    atomic_write(&path, &next)?;
    Ok(true)
}

fn needs_upgrade(directory: &Path, version: Option<u32>, locale: Option<&str>) -> bool {
    if version.unwrap_or(1) < SKELETON_VERSION {
        return true;
    }
    let Some(id) = locale else {
        return true;
    };
    match preset(id) {
        Ok(pack) => baseline_missing(directory, pack),
        Err(_) => true,
    }
}

fn base_files(pack: &LedgerPreset) -> Vec<(&'static str, &'static str)> {
    let mut files = vec![
        ("policies/base/chart-of-accounts.md", pack.chart_of_accounts),
        ("policies/base/document-filing.md", pack.document_filing),
        ("policies/base/bookkeeping-guide.md", pack.bookkeeping_guide),
    ];
    if let Some(rules) = pack.rules {
        files.push(("policies/base/rules.toml", rules));
    }
    files
}

fn baseline_files(pack: &LedgerPreset) -> Vec<(&'static str, &'static str)> {
    let mut files = vec![("policies/README.md", pack.policies_readme)];
    files.extend(base_files(pack));
    files
}

fn baseline_missing(directory: &Path, pack: &LedgerPreset) -> bool {
    baseline_files(pack)
        .into_iter()
        .any(|(rel, _)| !directory.join(rel).is_file())
        || gitignore_needs_update(directory)
        || !directory.join("documents").is_dir()
}

fn sync_baseline(directory: &Path, pack: &LedgerPreset) -> Result<Vec<String>, String> {
    let mut written = Vec::new();
    let documents = directory.join("documents");
    if !documents.is_dir() {
        fs::create_dir_all(&documents).map_err(|error| error.to_string())?;
        written.push("documents".into());
    }
    if ensure_backup_gitignore(directory)? {
        written.push(".gitignore".into());
    }
    fs::create_dir_all(directory.join("policies/base")).map_err(|error| error.to_string())?;
    if write_missing(&directory.join("policies/README.md"), pack.policies_readme)? {
        written.push("policies/README.md".into());
    }
    for (rel, contents) in base_files(pack) {
        if write_if_changed(&directory.join(rel), contents)? {
            written.push(rel.to_string());
        }
    }
    if pack.rules.is_none() {
        let stale_rules = directory.join("policies/base/rules.toml");
        if stale_rules.is_file() {
            fs::remove_file(&stale_rules).map_err(|error| error.to_string())?;
        }
    }
    Ok(written)
}

fn gitignore_needs_update(directory: &Path) -> bool {
    !fs::read_to_string(directory.join(".gitignore"))
        .is_ok_and(|current| gitignore_covers(&current))
}

fn gitignore_covers(text: &str) -> bool {
    gitignore_missing_lines(text).is_empty()
}

fn gitignore_missing_lines(text: &str) -> Vec<&'static str> {
    BACKUP_GITIGNORE
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !text.lines().map(str::trim).any(|got| got == *line))
        .collect()
}

fn atomic_write(path: &Path, contents: &str) -> Result<(), String> {
    let Some(name) = path.file_name() else {
        return Err("directory".to_string());
    };
    let tmp = path.with_file_name(format!("{}.beandesk-tmp", name.to_string_lossy()));
    fs::write(&tmp, contents).map_err(|error| error.to_string())?;
    if fs::rename(&tmp, path).is_err() {
        let _ = fs::remove_file(path);
        if let Err(error) = fs::rename(&tmp, path) {
            let _ = fs::remove_file(&tmp);
            return Err(error.to_string());
        }
    }
    Ok(())
}

fn read_marker(directory: &Path) -> Option<LedgerMarker> {
    let text = fs::read_to_string(directory.join(APP_MARKER)).ok()?;
    parse_marker(&text)
}

fn parse_marker(text: &str) -> Option<LedgerMarker> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.eq_ignore_ascii_case("beandesk") {
        return Some(LedgerMarker {
            version: 1,
            locale: String::new(),
        });
    }
    serde_json::from_str(trimmed).ok()
}

pub(crate) fn read_marker_locale(directory: &Path) -> Option<String> {
    read_marker(directory).and_then(|marker| {
        let id = marker.locale.trim();
        if id.is_empty() {
            None
        } else {
            Some(id.to_string())
        }
    })
}

pub(crate) fn write_marker(directory: &Path, locale: &str) -> Result<(), String> {
    let marker = LedgerMarker {
        version: SKELETON_VERSION,
        locale: locale.to_string(),
    };
    let body = serde_json::to_string(&marker).map_err(|error| error.to_string())?;
    fs::write(directory.join(APP_MARKER), format!("{body}\n")).map_err(|error| error.to_string())
}

fn write_new(path: impl AsRef<Path>, contents: &str) -> Result<(), String> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path.as_ref())
        .and_then(|mut file| file.write_all(contents.as_bytes()))
        .map_err(|error| error.to_string())
}

fn write_missing(path: &Path, contents: &str) -> Result<bool, String> {
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
    {
        Ok(mut file) => {
            file.write_all(contents.as_bytes())
                .map_err(|error| error.to_string())?;
            Ok(true)
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn write_if_changed(path: &Path, contents: &str) -> Result<bool, String> {
    if let Ok(current) = fs::read_to_string(path) {
        if current == contents {
            return Ok(false);
        }
    }
    atomic_write(path, contents)?;
    Ok(true)
}

fn effectively_empty(directory: &Path) -> Result<bool, String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let name = entry.map_err(|error| error.to_string())?.file_name();
        let name = name.to_string_lossy();
        if name == ".DS_Store" || name == "Thumbs.db" || name == "desktop.ini" {
            continue;
        }
        return Ok(false);
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "beandesk-init-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write_v1_ledger(root: &Path) {
        fs::create_dir_all(root.join("config")).unwrap();
        fs::create_dir_all(root.join("data/2026")).unwrap();
        fs::create_dir_all(root.join("documents")).unwrap();
        fs::write(root.join("main.bean"), "option \"title\" \"Ledger\"\n").unwrap();
        fs::write(root.join("config/accounts.bean"), "keep-accounts\n").unwrap();
        fs::write(root.join("data/2026/2026-03.bean"), "keep-posting\n").unwrap();
        fs::write(root.join(APP_MARKER), "beandesk\n").unwrap();
    }

    #[test]
    fn writes_a_zh_cn_ledger_and_refuses_to_overwrite() {
        let root = scratch("zh");
        init_ledger_tree(&root, "zh-CN").unwrap();
        assert!(root.join("main.bean").is_file());
        assert!(root.join("config/accounts.bean").is_file());
        assert!(root.join("config/commodities.bean").is_file());
        assert!(root.join("documents").is_dir());
        assert!(root.join("policies/base/rules.toml").is_file());
        let policies = fs::read_to_string(root.join("policies/README.md")).unwrap();
        assert!(policies.contains("Bookkeeping policies"));
        assert!(policies.contains("base/"));
        let main = fs::read_to_string(root.join("main.bean")).unwrap();
        assert!(main.contains("option \"documents\" \"documents\""));
        assert!(main.contains("option \"operating_currency\" \"CNY\""));
        let ignore = fs::read_to_string(root.join(".gitignore")).unwrap();
        assert!(ignore.contains(".backup_key"));
        let commodities = fs::read_to_string(root.join("config/commodities.bean")).unwrap();
        assert!(commodities.contains("commodity CNY"));
        assert!(commodities.contains("commodity USD"));
        let accounts = fs::read_to_string(root.join("config/accounts.bean")).unwrap();
        assert!(accounts.contains("Assets:Bank-银行存款:Main-基本户"));
        assert!(accounts.contains("Equity:Capital-实收资本:PaidIn-股东出资"));
        assert!(accounts.contains("cash: TRUE"));
        assert!(!accounts.contains("软件定制开发"));
        assert!(!accounts.contains("云计算与算力"));
        assert!(app_created_ledger(&root));
        let marker: LedgerMarker =
            serde_json::from_str(&fs::read_to_string(root.join(APP_MARKER)).unwrap()).unwrap();
        assert_eq!(marker.version, SKELETON_VERSION);
        assert_eq!(marker.locale, "zh-CN");
        assert_eq!(inspect_ledger(&root).unwrap().kind, "current");
        assert_eq!(
            init_ledger_tree(&root, "zh-CN").err().as_deref(),
            Some("ledger-exists")
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn writes_an_english_usd_ledger() {
        let root = scratch("en");
        init_ledger_tree(&root, "en").unwrap();
        let main = fs::read_to_string(root.join("main.bean")).unwrap();
        assert!(main.contains("option \"operating_currency\" \"USD\""));
        let accounts = fs::read_to_string(root.join("config/accounts.bean")).unwrap();
        assert!(accounts.contains("Assets:Bank:Checking"));
        assert!(accounts.contains("Equity:Capital:PaidIn"));
        assert!(!accounts.contains("银行存款"));
        assert!(!root.join("policies/base/rules.toml").exists());
        let marker: LedgerMarker =
            serde_json::from_str(&fs::read_to_string(root.join(APP_MARKER)).unwrap()).unwrap();
        assert_eq!(marker.locale, "en");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_a_relative_directory() {
        assert_eq!(
            init_ledger_tree(Path::new("relative"), "zh-CN")
                .err()
                .as_deref(),
            Some("directory")
        );
    }

    #[test]
    fn refuses_a_folder_that_already_has_files() {
        let root = scratch("not-empty");
        fs::write(root.join("notes.txt"), "keep").unwrap();
        assert_eq!(
            init_ledger_tree(&root, "zh-CN").err().as_deref(),
            Some("not-empty")
        );
        assert!(!root.join("main.bean").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn treats_finder_metadata_as_empty() {
        let root = scratch("dsstore");
        fs::write(root.join(".DS_Store"), "").unwrap();
        init_ledger_tree(&root, "zh-CN").unwrap();
        assert!(root.join("main.bean").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_a_bare_beandesk_marker_as_version_one() {
        let marker = parse_marker("beandesk\n").unwrap();
        assert_eq!(marker.version, 1);
        assert!(marker.locale.is_empty());
    }

    #[test]
    fn inspects_v1_and_foreign_ledgers() {
        let v1 = scratch("inspect-v1");
        write_v1_ledger(&v1);
        let inspect = inspect_ledger(&v1).unwrap();
        assert_eq!(inspect.kind, "outdated");
        assert_eq!(inspect.version, Some(1));
        assert!(inspect.app_ledger);
        let _ = fs::remove_dir_all(&v1);

        let foreign = scratch("inspect-foreign");
        fs::write(foreign.join("main.bean"), "option \"title\" \"Old\"\n").unwrap();
        let inspect = inspect_ledger(&foreign).unwrap();
        assert_eq!(inspect.kind, "foreign");
        assert!(!inspect.app_ledger);
        let _ = fs::remove_dir_all(&foreign);
    }

    #[test]
    fn upgrades_a_v1_ledger_without_touching_data() {
        let root = scratch("upgrade-v1");
        write_v1_ledger(&root);
        fs::create_dir_all(root.join("policies/base")).unwrap();
        fs::write(root.join("policies/README.md"), "keep-readme\n").unwrap();
        let report = upgrade_ledger_tree(&root, "zh-CN").unwrap();
        assert!(!report.adopted);
        assert!(
            report
                .written
                .contains(&"policies/base/chart-of-accounts.md".into())
        );
        assert!(
            !report
                .written
                .iter()
                .any(|path| path == "policies/README.md")
        );
        assert_eq!(
            fs::read_to_string(root.join("data/2026/2026-03.bean")).unwrap(),
            "keep-posting\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("config/accounts.bean")).unwrap(),
            "keep-accounts\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("policies/README.md")).unwrap(),
            "keep-readme\n"
        );
        assert!(root.join("policies/base/rules.toml").is_file());
        let marker: LedgerMarker =
            serde_json::from_str(&fs::read_to_string(root.join(APP_MARKER)).unwrap()).unwrap();
        assert_eq!(marker.version, SKELETON_VERSION);
        assert_eq!(marker.locale, "zh-CN");
        assert_eq!(inspect_ledger(&root).unwrap().kind, "current");
        assert!(
            upgrade_ledger_tree(&root, "zh-CN")
                .unwrap()
                .written
                .is_empty()
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn upgrades_a_v2_ledger_and_refreshes_base_guides_without_touching_custom_files() {
        let root = scratch("upgrade-v2");
        init_ledger_tree(&root, "zh-CN").unwrap();
        fs::write(
            root.join(APP_MARKER),
            "{\"version\":2,\"locale\":\"zh-CN\"}\n",
        )
        .unwrap();
        fs::write(
            root.join("policies/base/bookkeeping-guide.md"),
            "old-v2-bookkeeping-guide\n",
        )
        .unwrap();
        fs::write(
            root.join("policies/base/document-filing.md"),
            "old-v2-document-filing\n",
        )
        .unwrap();
        fs::write(root.join("policies/README.md"), "keep-user-readme\n").unwrap();
        fs::write(root.join("policies/travel.md"), "keep-custom-policy\n").unwrap();
        fs::write(root.join("data/2026-03.bean"), "keep-entry\n").unwrap();

        let inspect = inspect_ledger(&root).unwrap();
        assert_eq!(inspect.kind, "outdated");
        assert_eq!(inspect.version, Some(2));

        let report = upgrade_ledger_tree(&root, "zh-CN").unwrap();
        assert!(!report.adopted);
        assert_eq!(report.version, SKELETON_VERSION);
        assert!(
            report
                .written
                .contains(&"policies/base/bookkeeping-guide.md".into())
        );
        assert!(
            report
                .written
                .contains(&"policies/base/document-filing.md".into())
        );
        assert!(
            !report
                .written
                .contains(&"policies/base/chart-of-accounts.md".into())
        );
        assert!(
            fs::read_to_string(root.join("policies/base/bookkeeping-guide.md"))
                .unwrap()
                .contains("入账前查重")
        );
        assert_eq!(
            fs::read_to_string(root.join("policies/README.md")).unwrap(),
            "keep-user-readme\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("policies/travel.md")).unwrap(),
            "keep-custom-policy\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("data/2026-03.bean")).unwrap(),
            "keep-entry\n"
        );
        assert_eq!(inspect_ledger(&root).unwrap().kind, "current");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn adopts_an_unmarked_beancount_folder() {
        let root = scratch("adopt");
        fs::write(root.join("main.bean"), "option \"title\" \"Mine\"\n").unwrap();
        fs::create_dir_all(root.join("data")).unwrap();
        fs::write(root.join("data/keep.bean"), "keep-entry\n").unwrap();
        let report = upgrade_ledger_tree(&root, "en").unwrap();
        assert!(report.adopted);
        assert!(app_created_ledger(&root));
        assert!(root.join("policies/base/chart-of-accounts.md").is_file());
        assert!(!root.join("policies/base/rules.toml").exists());
        assert_eq!(
            fs::read_to_string(root.join("data/keep.bean")).unwrap(),
            "keep-entry\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("main.bean")).unwrap(),
            "option \"title\" \"Mine\"\n"
        );
        assert_eq!(inspect_ledger(&root).unwrap().kind, "current");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn inspects_a_v2_marker_without_locale_as_outdated() {
        let root = scratch("v2-no-locale");
        fs::write(root.join("main.bean"), "option \"title\" \"Ledger\"\n").unwrap();
        fs::write(root.join(APP_MARKER), "{\"version\":2}\n").unwrap();
        let inspect = inspect_ledger(&root).unwrap();
        assert_eq!(inspect.kind, "outdated");
        assert_eq!(inspect.version, Some(2));
        assert!(inspect.locale.is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn upgrade_without_main_bean_is_rejected() {
        let root = scratch("no-main");
        assert_eq!(
            upgrade_ledger_tree(&root, "zh-CN").err().as_deref(),
            Some("main-bean")
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn revert_created_removes_files_and_new_roots() {
        let root = scratch("revert");
        let config = root.join("config");
        fs::create_dir_all(config.join("inner")).unwrap();
        let main = root.join("main.bean");
        fs::write(&main, "partial\n").unwrap();
        revert_created(&[main.clone()], &[config.clone()]);
        assert!(!main.exists());
        assert!(!config.exists());
        assert!(root.is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn gitignore_appends_only_missing_lines() {
        let existing = ".backup_key\n.env\n.DS_Store\n";
        assert_eq!(
            gitignore_missing_lines(existing),
            vec![".backup_key.new", "backups/"]
        );
        assert!(gitignore_covers(BACKUP_GITIGNORE));
        assert!(!gitignore_covers(".backup_key.new\nbackups/\n"));
    }
}
