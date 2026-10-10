use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use crate::ledger_preset::preset;
use crate::mcp::policy_lint::{
    POLICY_TOML_MAX_BYTES, PolicyLint, is_baseline_toml, lint_from_texts, list_toml_files,
    validate_policy_text,
};

const POLICY_FILE: &str = "policy.json";
const BASE_RULES: &str = "policies/base/rules.toml";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Integrity {
    Ok,
    Unseeded,
    Unapproved,
    LocaleMismatch,
    StoreCorrupt,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PolicyFileStore {
    #[serde(default)]
    ledgers: BTreeMap<String, LedgerPolicy>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerPolicy {
    pub locale: String,
    #[serde(default)]
    pub files: BTreeMap<String, String>,
    pub hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_reason: Option<String>,
}

static STORE_IO: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PolicyFileView {
    pub path: String,
    pub trusted: Option<String>,
    pub disk: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PolicyStatus {
    pub integrity: Integrity,
    pub baseline_drift: bool,
    pub locale: Option<String>,
    pub review_reason: Option<String>,
    pub files: Vec<PolicyFileView>,
}

#[derive(Clone, Debug)]
pub struct PolicyDb {
    path: PathBuf,
}

impl PolicyDb {
    pub fn standard() -> Result<Self, String> {
        Ok(Self {
            path: standard_path()?,
        })
    }

    #[cfg(test)]
    pub fn at(path: PathBuf) -> Self {
        Self { path }
    }

    fn load(&self) -> PolicyFileStore {
        let _guard = STORE_IO
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.load_unlocked()
    }

    fn load_unlocked(&self) -> PolicyFileStore {
        let Ok(text) = fs::read_to_string(&self.path) else {
            return PolicyFileStore::default();
        };
        serde_json::from_str(&text).unwrap_or_default()
    }

    fn save_unlocked(&self, store: &PolicyFileStore) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let body = serde_json::to_string_pretty(store).map_err(|error| error.to_string())?;
        atomic_write(&self.path, &format!("{body}\n"))
    }

    fn with_store<T>(
        &self,
        edit: impl FnOnce(&mut PolicyFileStore) -> Result<T, String>,
    ) -> Result<T, String> {
        let _guard = STORE_IO
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut store = self.load_unlocked();
        let result = edit(&mut store)?;
        self.save_unlocked(&store)?;
        Ok(result)
    }

    pub fn get(&self, directory: &Path) -> Option<LedgerPolicy> {
        let store = self.load();
        lookup_key(&store, directory).and_then(|key| store.ledgers.get(&key).cloned())
    }

    pub fn seed_current(directory: &Path, locale: &str) -> Result<(), String> {
        match Self::standard() {
            Ok(db) => db.seed_if_absent(directory, locale).map(|_| ()),
            Err(_) => Ok(()),
        }
    }

    pub fn seed_if_absent(&self, directory: &Path, locale: &str) -> Result<bool, String> {
        let locale = locale.trim().to_string();
        preset(&locale)?;
        self.with_store(|store| {
            if lookup_key(store, directory).is_some() {
                return Ok(false);
            }
            store
                .ledgers
                .insert(ledger_key(directory), empty_entry(&locale));
            Ok(true)
        })
    }

    pub fn put(&self, directory: &Path, entry: LedgerPolicy) -> Result<(), String> {
        self.with_store(|store| {
            let key = lookup_key(store, directory).unwrap_or_else(|| ledger_key(directory));
            store.ledgers.insert(key, entry);
            Ok(())
        })
    }

    pub fn follow_workdir(&self, old: &Path, new: &Path) -> Result<bool, String> {
        self.with_store(|store| {
            if lookup_key(store, new).is_some() {
                return Ok(false);
            }
            let Some(old_key) = lookup_key(store, old) else {
                return Ok(false);
            };
            if old.exists() {
                return Ok(false);
            }
            let new_key = ledger_key(new);
            let Some(entry) = store.ledgers.remove(&old_key) else {
                return Ok(false);
            };
            store.ledgers.insert(new_key, entry);
            Ok(true)
        })
    }

    pub fn mark_restore(&self, directory: &Path) -> Result<(), String> {
        if let Some(locale) = disk_locale(directory) {
            let _ = self.seed_if_absent(directory, &locale);
        }
        self.with_store(|store| {
            let Some(key) = lookup_key(store, directory) else {
                return Ok(());
            };
            if let Some(entry) = store.ledgers.get_mut(&key) {
                entry.review_reason = Some("restore".into());
            }
            Ok(())
        })
    }

    pub fn inspect(&self, directory: &Path) -> PolicyStatus {
        status_of(directory, self.get(directory).as_ref())
    }

    pub fn review(&self, directory: &Path) -> (PolicyStatus, PolicyLint) {
        let entry = self.get(directory);
        let status = status_of(directory, entry.as_ref());
        let texts = trusted_texts(entry.as_ref(), &status);
        let lint = match lint_from_texts(directory, &texts) {
            Ok(violations) => PolicyLint::Checked(violations),
            Err(error) => PolicyLint::LoadError(error),
        };
        (status, lint)
    }

    pub fn approve(&self, directory: &Path) -> Result<PolicyStatus, String> {
        let Some(mut entry) = self.get(directory) else {
            return Err("unseeded".into());
        };
        let files = read_custom_files(directory)?;
        for (path, text) in &files {
            validate_policy_text(path, text)?;
        }
        entry.files = files;
        entry.hash = hash_files(&entry.files);
        entry.review_reason = None;
        self.put(directory, entry)?;
        Ok(self.inspect(directory))
    }

    pub fn revert(&self, directory: &Path) -> Result<PolicyStatus, String> {
        let Some(mut entry) = self.get(directory) else {
            return Err("unseeded".into());
        };
        write_custom_files(directory, &entry.files)?;
        write_baseline_rules(directory, &entry.locale)?;
        crate::ledger_init::write_marker(directory, &entry.locale)?;
        entry.review_reason = None;
        self.put(directory, entry)?;
        Ok(self.inspect(directory))
    }

    pub fn switch_locale(&self, directory: &Path, locale: &str) -> Result<PolicyStatus, String> {
        let locale = locale.trim();
        preset(locale)?;
        let Some(mut entry) = self.get(directory) else {
            self.seed_if_absent(directory, locale)?;
            write_baseline_rules(directory, locale)?;
            crate::ledger_init::write_marker(directory, locale)?;
            return Ok(self.inspect(directory));
        };
        entry.locale = locale.to_string();
        entry.review_reason = None;
        write_baseline_rules(directory, locale)?;
        crate::ledger_init::write_marker(directory, locale)?;
        self.put(directory, entry)?;
        Ok(self.inspect(directory))
    }
}

fn trusted_texts(entry: Option<&LedgerPolicy>, status: &PolicyStatus) -> Vec<(String, String)> {
    let mut files = Vec::new();
    if let Some(locale) = &status.locale {
        push_pack_rules(&mut files, locale);
    }
    if matches!(
        status.integrity,
        Integrity::LocaleMismatch | Integrity::Unapproved | Integrity::Ok
    ) {
        if let Some(entry) = entry {
            files.extend(
                entry
                    .files
                    .iter()
                    .map(|(path, text)| (path.clone(), text.clone())),
            );
        }
    }
    files
}

fn push_pack_rules(files: &mut Vec<(String, String)>, locale: &str) {
    if let Ok(pack) = preset(locale) {
        if let Some(rules) = pack.rules {
            files.push(("base/rules.toml".into(), rules.to_string()));
        }
    }
}

fn status_of(directory: &Path, entry: Option<&LedgerPolicy>) -> PolicyStatus {
    let disk_result = read_custom_files(directory);
    let disk_custom = disk_result.as_ref().ok().cloned().unwrap_or_default();
    let marker = disk_locale(directory);
    let integrity = match entry {
        None => Integrity::Unseeded,
        Some(item)
            if item
                .files
                .iter()
                .any(|(path, text)| validate_policy_text(path, text).is_err()) =>
        {
            Integrity::StoreCorrupt
        }
        Some(item) if marker.as_deref() != Some(item.locale.as_str()) => Integrity::LocaleMismatch,
        Some(item) if disk_result.is_err() || hash_files(&disk_custom) != item.hash => {
            Integrity::Unapproved
        }
        Some(_) => Integrity::Ok,
    };
    let locale = match entry {
        Some(item) => Some(item.locale.clone()),
        None => marker.clone(),
    };
    let pack_locale = locale.as_deref().or(marker.as_deref());
    let baseline = drifted_baseline(directory, pack_locale);
    let mut files = custom_views(entry, &disk_custom);
    let baseline_drift = baseline.is_some();
    if let Some(view) = baseline {
        files.push(view);
    }
    PolicyStatus {
        integrity,
        baseline_drift,
        locale,
        review_reason: entry.and_then(|item| item.review_reason.clone()),
        files,
    }
}

fn custom_views(
    entry: Option<&LedgerPolicy>,
    disk: &BTreeMap<String, String>,
) -> Vec<PolicyFileView> {
    let mut paths = BTreeSet::new();
    paths.extend(disk.keys().cloned());
    if let Some(entry) = entry {
        paths.extend(entry.files.keys().cloned());
    }
    paths
        .into_iter()
        .map(|path| PolicyFileView {
            trusted: entry.and_then(|item| item.files.get(&path).cloned()),
            disk: disk.get(&path).cloned(),
            path,
        })
        .collect()
}

fn drifted_baseline(directory: &Path, locale: Option<&str>) -> Option<PolicyFileView> {
    let path = directory.join(BASE_RULES);
    if !path.is_file() {
        return None;
    }
    let disk = fs::read_to_string(&path).ok()?;
    let trusted = locale
        .and_then(|id| preset(id).ok())
        .and_then(|pack| pack.rules);
    if disk == trusted.unwrap_or("") {
        return None;
    }
    Some(PolicyFileView {
        path: "base/rules.toml".into(),
        trusted: trusted.map(str::to_string),
        disk: Some(disk),
    })
}

fn read_custom_files(directory: &Path) -> Result<BTreeMap<String, String>, String> {
    let mut files = BTreeMap::new();
    for (id, path) in list_toml_files(&directory.join("policies"))? {
        if is_baseline_toml(&id) {
            continue;
        }
        let key = nfc(&id);
        let metadata = path
            .metadata()
            .map_err(|_| format!("{key}: could not read policy file."))?;
        if metadata.len() > POLICY_TOML_MAX_BYTES {
            return Err(format!("{key}: Policy file is too large."));
        }
        let text =
            fs::read_to_string(&path).map_err(|_| format!("{key}: could not read policy file."))?;
        files.insert(key, text);
    }
    Ok(files)
}

fn write_custom_files(directory: &Path, files: &BTreeMap<String, String>) -> Result<(), String> {
    let root = directory.join("policies");
    let current = read_custom_files(directory)?;
    for path in current.keys() {
        if !files.contains_key(path) {
            let _ = fs::remove_file(root.join(path));
        }
    }
    for (rel, text) in files {
        let path = root.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&path, text).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn write_baseline_rules(directory: &Path, locale: &str) -> Result<(), String> {
    let pack = preset(locale)?;
    let path = directory.join(BASE_RULES);
    match pack.rules {
        Some(rules) => {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::write(&path, rules).map_err(|error| error.to_string())
        }
        None => {
            if path.is_file() {
                fs::remove_file(&path).map_err(|error| error.to_string())?;
            }
            Ok(())
        }
    }
}

fn empty_entry(locale: &str) -> LedgerPolicy {
    let files = BTreeMap::new();
    LedgerPolicy {
        locale: locale.to_string(),
        hash: hash_files(&files),
        files,
        review_reason: None,
    }
}

fn hash_files(files: &BTreeMap<String, String>) -> String {
    let mut hasher = Sha256::new();
    for (path, content) in files {
        hasher.update(path.as_bytes());
        hasher.update([0u8]);
        hasher.update(content.as_bytes());
        hasher.update([0u8]);
    }
    hex_lower(&hasher.finalize())
}

fn hex_lower(bytes: impl AsRef<[u8]>) -> String {
    bytes.as_ref().iter().fold(String::new(), |mut out, byte| {
        use std::fmt::Write;
        let _ = write!(out, "{byte:02x}");
        out
    })
}

fn nfc(value: &str) -> String {
    value.nfc().collect()
}

fn ledger_key(directory: &Path) -> String {
    match directory.canonicalize() {
        Ok(resolved) => nfc(&resolved.to_string_lossy()),
        Err(_) => nfc(&directory.to_string_lossy()),
    }
}

fn lookup_key(store: &PolicyFileStore, directory: &Path) -> Option<String> {
    let mut wanted = Vec::new();
    if let Ok(resolved) = directory.canonicalize() {
        wanted.push(comparable_key(&resolved.to_string_lossy()));
    }
    wanted.push(comparable_key(&directory.to_string_lossy()));
    store
        .ledgers
        .keys()
        .find(|key| wanted.iter().any(|item| comparable_key(key) == *item))
        .cloned()
}

fn comparable_key(value: &str) -> String {
    let normalized = nfc(value);
    let without_unc = normalized.strip_prefix(r"\\?\").unwrap_or(&normalized);
    let without_private = without_unc.strip_prefix("/private").unwrap_or(without_unc);
    let trimmed = without_private.trim_end_matches(['/', '\\']);
    if let Some((drive, rest)) = trimmed.split_once(':') {
        if drive.len() == 1 {
            if let Some(letter) = drive.chars().next() {
                if letter.is_ascii_alphabetic() {
                    return format!("{}:{rest}", letter.to_ascii_uppercase());
                }
            }
        }
    }
    trimmed.to_string()
}

fn disk_locale(directory: &Path) -> Option<String> {
    crate::ledger_init::read_marker_locale(directory)
}

fn standard_path() -> Result<PathBuf, String> {
    if cfg!(test) {
        return Ok(
            std::env::temp_dir().join(format!("beandesk-policy-test-{}.json", std::process::id()))
        );
    }
    dirs::data_dir()
        .map(|dir| dir.join("app.beandesk.desktop").join(POLICY_FILE))
        .ok_or_else(|| "missing".to_string())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::policy_lint::{PolicyLint, PolicyViolation};

    fn scratch(tag: &str) -> (PathBuf, PolicyDb) {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "beandesk-policy-{tag}-{}-{stamp}",
            std::process::id()
        ));
        cleanup(&root);
        fs::create_dir_all(root.join("data")).unwrap();
        fs::create_dir_all(root.join("policies")).unwrap();
        let db = PolicyDb::at(root.with_extension("policy.json"));
        (root, db)
    }

    fn cleanup(root: &Path) {
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_file(root.with_extension("policy.json"));
    }

    fn repay() -> &'static str {
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

    fn txn(narration: &str) -> String {
        format!(
            "2026-03-15 * \"Owner\" \"{narration}\"\n  Liabilities:Owner:Advance    100.00 CNY\n  Assets:Bank:Checking       -100.00 CNY\n"
        )
    }

    fn violations(root: &Path, db: &PolicyDb) -> Vec<PolicyViolation> {
        match db.review(root).1 {
            PolicyLint::Checked(items) => items,
            PolicyLint::LoadError(error) => panic!("{error}"),
        }
    }

    #[test]
    fn seed_is_idempotent_and_starts_ok() {
        let (root, db) = scratch("seed");
        crate::ledger_init::write_marker(&root, "en").unwrap();
        assert!(db.seed_if_absent(&root, "en").unwrap());
        assert!(!db.seed_if_absent(&root, "zh-CN").unwrap());
        let status = db.inspect(&root);
        assert_eq!(status.integrity, Integrity::Ok);
        assert_eq!(status.locale.as_deref(), Some("en"));
        assert!(!status.baseline_drift);
        cleanup(&root);
    }

    #[test]
    fn missing_english_baseline_file_is_not_drift() {
        let (root, db) = scratch("en-base");
        crate::ledger_init::write_marker(&root, "en").unwrap();
        db.seed_if_absent(&root, "en").unwrap();
        assert!(!db.inspect(&root).baseline_drift);
        cleanup(&root);
    }

    #[test]
    fn extra_english_baseline_file_is_drift_and_is_not_executed() {
        let (root, db) = scratch("en-extra");
        crate::ledger_init::write_marker(&root, "en").unwrap();
        db.seed_if_absent(&root, "en").unwrap();
        fs::create_dir_all(root.join("policies/base")).unwrap();
        fs::write(root.join(BASE_RULES), repay()).unwrap();
        fs::write(root.join("data/2026-03.bean"), txn("转账")).unwrap();
        let status = db.inspect(&root);
        assert_eq!(status.integrity, Integrity::Ok);
        assert!(status.baseline_drift);
        assert!(violations(&root, &db).is_empty());
        cleanup(&root);
    }

    #[test]
    fn deleted_zh_cn_baseline_still_runs_the_pack() {
        let (root, db) = scratch("zh-del");
        crate::ledger_init::write_marker(&root, "zh-CN").unwrap();
        db.seed_if_absent(&root, "zh-CN").unwrap();
        fs::write(
            root.join("data/2026-03.bean"),
            "2026-03-15 * \"Client\" \"Fee\"\n  Assets:Bank:Checking    50000.00 CNY\n  Income:Sales           -50000.00 CNY\n",
        )
        .unwrap();
        let hits = violations(&root, &db);
        assert!(!hits.is_empty());
        assert!(
            hits.iter()
                .all(|item| item.rule_id == "localized-account-naming")
        );
        cleanup(&root);
    }

    #[test]
    fn agent_locale_change_does_not_drop_zh_cn_rules() {
        let (root, db) = scratch("locale-hack");
        crate::ledger_init::write_marker(&root, "zh-CN").unwrap();
        db.seed_if_absent(&root, "zh-CN").unwrap();
        crate::ledger_init::write_marker(&root, "en").unwrap();
        let status = db.inspect(&root);
        assert_eq!(status.integrity, Integrity::LocaleMismatch);
        fs::write(
            root.join("data/2026-03.bean"),
            "2026-03-15 * \"Client\" \"Fee\"\n  Assets:Bank:Checking    50000.00 CNY\n  Income:Sales           -50000.00 CNY\n",
        )
        .unwrap();
        assert!(!violations(&root, &db).is_empty());
        cleanup(&root);
    }

    #[test]
    fn unapproved_custom_files_are_not_executed() {
        let (root, db) = scratch("unapproved");
        crate::ledger_init::write_marker(&root, "en").unwrap();
        db.seed_if_absent(&root, "en").unwrap();
        fs::write(root.join("policies/repay.toml"), repay()).unwrap();
        fs::write(root.join("data/2026-03.bean"), txn("转账")).unwrap();
        let status = db.inspect(&root);
        assert_eq!(status.integrity, Integrity::Unapproved);
        assert!(violations(&root, &db).is_empty());
        db.approve(&root).unwrap();
        assert_eq!(db.inspect(&root).integrity, Integrity::Ok);
        assert_eq!(violations(&root, &db).len(), 1);
        fs::write(root.join("policies/repay.toml"), "[[rules]]\n").unwrap();
        assert_eq!(db.inspect(&root).integrity, Integrity::Unapproved);
        assert_eq!(violations(&root, &db).len(), 1);
        cleanup(&root);
    }

    #[test]
    fn approve_rejects_unparseable_files() {
        let (root, db) = scratch("bad-approve");
        crate::ledger_init::write_marker(&root, "en").unwrap();
        db.seed_if_absent(&root, "en").unwrap();
        fs::write(root.join("policies/broken.toml"), "not toml").unwrap();
        assert!(db.approve(&root).is_err());
        assert_eq!(db.inspect(&root).integrity, Integrity::Unapproved);
        cleanup(&root);
    }

    #[test]
    fn follow_workdir_moves_the_entry_when_the_old_folder_is_gone() {
        let (root, db) = scratch("follow");
        crate::ledger_init::write_marker(&root, "en").unwrap();
        db.seed_if_absent(&root, "en").unwrap();
        db.approve(&root).unwrap();
        let moved =
            std::env::temp_dir().join(format!("beandesk-policy-moved-{}", std::process::id()));
        let _ = fs::remove_dir_all(&moved);
        fs::rename(&root, &moved).unwrap();
        assert!(db.follow_workdir(&root, &moved).unwrap());
        assert_eq!(db.inspect(&moved).integrity, Integrity::Ok);
        let _ = fs::remove_dir_all(&moved);
        cleanup(&root);
    }

    #[test]
    fn unseeded_uses_disk_locale_only_for_the_pack() {
        let (root, db) = scratch("unseeded");
        crate::ledger_init::write_marker(&root, "zh-CN").unwrap();
        fs::write(root.join("policies/repay.toml"), repay()).unwrap();
        fs::write(root.join("data/2026-03.bean"), txn("转账")).unwrap();
        let status = db.inspect(&root);
        assert_eq!(status.integrity, Integrity::Unseeded);
        let hits = violations(&root, &db);
        assert!(hits.iter().all(|item| item.rule_id != "repay-narration"));
        assert!(
            hits.iter()
                .any(|item| item.rule_id == "localized-account-naming")
        );
        cleanup(&root);
    }

    #[test]
    fn switch_locale_keeps_approved_custom_files() {
        let (root, db) = scratch("switch");
        crate::ledger_init::write_marker(&root, "zh-CN").unwrap();
        db.seed_if_absent(&root, "zh-CN").unwrap();
        fs::write(root.join("policies/repay.toml"), repay()).unwrap();
        db.approve(&root).unwrap();
        db.switch_locale(&root, "en").unwrap();
        let status = db.inspect(&root);
        assert_eq!(status.integrity, Integrity::Ok);
        assert_eq!(status.locale.as_deref(), Some("en"));
        assert!(!root.join(BASE_RULES).is_file());
        assert!(root.join("policies/repay.toml").is_file());
        cleanup(&root);
    }
}
