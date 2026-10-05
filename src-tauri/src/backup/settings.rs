use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use url::Url;

pub const SNAPSHOT_PATHS: [&str; 4] = ["main.bean", "config", "data", "documents"];
/// Git stays on the ledger text. Voucher files belong in the restic repositories.
pub const GIT_PATHS: [&str; 3] = ["main.bean", "config", "data"];
pub const KEY_FILE: &str = ".backup_key";
pub const DEFAULT_DEBOUNCE_SECS: u32 = 5;
pub const HOST: &str = "beandesk";

/// Keep every snapshot from the last 48 hours, then thin: 30 days, 12 weeks, 24 months.
pub const KEEP_WITHIN: &str = "48h";
pub const KEEP_WITHIN_DAILY: &str = "30d";
pub const KEEP_WITHIN_WEEKLY: &str = "84d";
pub const KEEP_WITHIN_MONTHLY: &str = "24m";
pub const CHECK_GROUPS: u32 = 7;

pub fn require_ledger(directory: &Path) -> Result<(), String> {
    if !directory.is_absolute() || !directory.is_dir() || !directory.join("main.bean").is_file() {
        return Err("directory".to_string());
    }
    Ok(())
}

/// `directory` / `missing` are left over from before the book existed. Drop them once `main.bean` is there.
pub fn clear_resolved_directory_error(last_error: &mut Option<String>, directory: &Path) {
    if matches!(last_error.as_deref(), Some("directory") | Some("missing"))
        && require_ledger(directory).is_ok()
    {
        *last_error = None;
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3Settings {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub bucket_name: String,
    pub region: String,
    pub endpoint: String,
    pub path_style_access: bool,
    pub prefix: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StoredDest {
    Local {
        id: String,
        directory: String,
    },
    S3 {
        id: String,
        access_key_id: String,
        secret_access_key: String,
        bucket_name: String,
        region: String,
        endpoint: String,
        path_style_access: bool,
        prefix: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DestInput {
    #[serde(default)]
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub directory: String,
    #[serde(default)]
    pub access_key_id: String,
    #[serde(default)]
    pub secret_access_key: String,
    #[serde(default)]
    pub bucket_name: String,
    #[serde(default)]
    pub region: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub path_style_access: bool,
    #[serde(default)]
    pub prefix: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DestView {
    pub id: String,
    pub kind: String,
    pub directory: String,
    pub access_key_id: String,
    pub bucket_name: String,
    pub region: String,
    pub endpoint: String,
    pub path_style_access: bool,
    pub prefix: String,
    pub secret_configured: bool,
    pub location: String,
    pub ready: bool,
    pub missing: bool,
    pub check_failed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BackupSettings {
    pub watch: bool,
    pub debounce_secs: u32,
    pub archive_auto: bool,
    #[serde(default)]
    pub dests: Vec<StoredDest>,
    /// Legacy one-local / one-S3 slots. Migrated into `dests` on load.
    #[serde(default)]
    pub archive_local: bool,
    #[serde(default)]
    pub archive_directory: String,
    #[serde(default)]
    pub s3_enabled: bool,
    #[serde(default)]
    pub s3: S3Settings,
    /// Repository locations whose last integrity check failed.
    #[serde(default)]
    pub pending_checks: Vec<String>,
}

impl Default for S3Settings {
    fn default() -> Self {
        Self {
            access_key_id: String::new(),
            secret_access_key: String::new(),
            bucket_name: String::new(),
            region: String::new(),
            endpoint: String::new(),
            path_style_access: true,
            prefix: String::new(),
        }
    }
}

impl Default for BackupSettings {
    fn default() -> Self {
        Self {
            watch: true,
            debounce_secs: DEFAULT_DEBOUNCE_SECS,
            archive_auto: false,
            dests: Vec::new(),
            archive_local: false,
            archive_directory: String::new(),
            s3_enabled: false,
            s3: S3Settings::default(),
            pending_checks: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettingsView {
    pub watch: bool,
    pub debounce_secs: u32,
    pub archive_auto: bool,
    pub dests: Vec<DestView>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSnapshot {
    pub id: String,
    pub time: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DestPulse {
    pub id: String,
    pub last_snapshot: Option<String>,
    pub last_snapshot_at: Option<String>,
}

#[derive(Clone, Debug)]
pub struct DestSnap {
    pub id: String,
    pub location: String,
    pub last_snapshot: Option<String>,
    pub last_snapshot_at: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub last_git_at: Option<String>,
    pub last_git_hash: Option<String>,
    pub last_snapshot: Option<String>,
    pub last_snapshot_at: Option<String>,
    pub last_error: Option<String>,
    pub watching: bool,
    pub has_key: bool,
    pub restic_ready: bool,
    pub app_ledger: bool,
    pub has_ledger_file: bool,
    pub dests: Vec<DestPulse>,
}

impl BackupSettings {
    pub fn view(&self) -> BackupSettingsView {
        BackupSettingsView {
            watch: self.watch,
            debounce_secs: self.debounce_secs,
            archive_auto: self.archive_auto,
            dests: self
                .dests
                .iter()
                .map(|dest| dest.view(&self.pending_checks))
                .collect(),
        }
    }

    pub fn has_ready_archive_dest(&self) -> bool {
        !self.ready_dests().is_empty()
    }

    pub fn archives_on_change(&self) -> bool {
        self.archive_auto && self.has_ready_archive_dest()
    }

    pub fn should_watch(&self) -> bool {
        self.watch || self.archives_on_change()
    }

    pub fn ready_dests(&self) -> Vec<ReadyDest> {
        self.dests.iter().filter_map(StoredDest::archive).collect()
    }

    pub fn reject_nested_dests(&self, workdir: &Path) -> Result<(), String> {
        for dest in &self.dests {
            if let StoredDest::Local { directory, .. } = dest {
                let path = Path::new(directory.trim());
                if !directory.trim().is_empty() {
                    reject_archive_inside_ledger(workdir, path)?;
                }
            }
        }
        Ok(())
    }
}

impl StoredDest {
    pub fn id(&self) -> &str {
        match self {
            Self::Local { id, .. } | Self::S3 { id, .. } => id,
        }
    }

    pub fn location_key(&self) -> String {
        match self {
            Self::Local { directory, .. } => directory.trim().to_string(),
            Self::S3 { .. } => s3_repository(&self.s3_settings().unwrap_or_default()),
        }
    }

    pub(crate) fn local(id: String, directory: &str) -> Self {
        Self::Local {
            id,
            directory: directory.to_string(),
        }
    }

    pub(crate) fn from_s3(id: String, s3: S3Settings) -> Self {
        Self::S3 {
            id,
            access_key_id: s3.access_key_id,
            secret_access_key: s3.secret_access_key,
            bucket_name: s3.bucket_name,
            region: s3.region,
            endpoint: s3.endpoint,
            path_style_access: s3.path_style_access,
            prefix: s3.prefix,
        }
    }

    fn s3_settings(&self) -> Option<S3Settings> {
        match self {
            Self::S3 {
                access_key_id,
                secret_access_key,
                bucket_name,
                region,
                endpoint,
                path_style_access,
                prefix,
                ..
            } => Some(S3Settings {
                access_key_id: access_key_id.clone(),
                secret_access_key: secret_access_key.clone(),
                bucket_name: bucket_name.clone(),
                region: region.clone(),
                endpoint: endpoint.clone(),
                path_style_access: *path_style_access,
                prefix: prefix.clone(),
            }),
            Self::Local { .. } => None,
        }
    }

    fn archive(&self) -> Option<ReadyDest> {
        let dest = match self {
            Self::Local { directory, .. } => {
                let path = PathBuf::from(directory.trim());
                path.is_dir().then_some(ArchiveDest::Local(path))?
            }
            Self::S3 { .. } => self
                .s3_settings()
                .and_then(|s3| s3_ready(&s3).ok().map(ArchiveDest::S3))?,
        };
        Some(ReadyDest {
            id: self.id().to_string(),
            dest,
        })
    }

    fn view(&self, pending_checks: &[String]) -> DestView {
        match self {
            Self::Local { id, directory } => {
                let directory = directory.trim().to_string();
                let missing = !Path::new(&directory).is_dir();
                DestView {
                    id: id.clone(),
                    kind: "local".into(),
                    directory: directory.clone(),
                    access_key_id: String::new(),
                    bucket_name: String::new(),
                    region: String::new(),
                    endpoint: String::new(),
                    path_style_access: true,
                    prefix: String::new(),
                    secret_configured: false,
                    location: directory.clone(),
                    ready: !missing,
                    missing,
                    check_failed: pending_checks.iter().any(|item| item == &directory),
                }
            }
            Self::S3 {
                id,
                access_key_id,
                bucket_name,
                region,
                endpoint,
                path_style_access,
                prefix,
                secret_access_key,
                ..
            } => {
                let s3 = self.s3_settings().unwrap_or_default();
                let ready = s3_ready(&s3).is_ok();
                let location = s3_repository(&s3);
                DestView {
                    id: id.clone(),
                    kind: "s3".into(),
                    directory: String::new(),
                    access_key_id: access_key_id.clone(),
                    bucket_name: bucket_name.clone(),
                    region: region.clone(),
                    endpoint: endpoint.clone(),
                    path_style_access: *path_style_access,
                    prefix: prefix.clone(),
                    secret_configured: !secret_access_key.is_empty(),
                    location: location.clone(),
                    ready,
                    missing: false,
                    check_failed: pending_checks.iter().any(|item| item == &location),
                }
            }
        }
    }
}

pub fn dest_pulses(settings: &BackupSettings, snaps: &[DestSnap]) -> Vec<DestPulse> {
    settings
        .dests
        .iter()
        .map(|dest| {
            let location = dest.location_key();
            let snap = snaps
                .iter()
                .find(|item| item.id == dest.id() && item.location == location);
            DestPulse {
                id: dest.id().to_string(),
                last_snapshot: snap.and_then(|item| item.last_snapshot.clone()),
                last_snapshot_at: snap.and_then(|item| item.last_snapshot_at.clone()),
            }
        })
        .collect()
}

pub fn new_dest_id(offset: u128) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    format!("{now:x}{offset:x}")
}

/// Move the old one-local / one-S3 slots into `dests` when the list is empty.
pub fn migrate_legacy_dests(settings: &mut BackupSettings) -> bool {
    if !settings.dests.is_empty() {
        return false;
    }
    let mut dests = Vec::new();
    if settings.archive_local {
        let directory = settings.archive_directory.trim();
        if !directory.is_empty() {
            dests.push(StoredDest::local(new_dest_id(0), directory));
        }
    }
    if settings.s3_enabled {
        dests.push(StoredDest::from_s3(new_dest_id(1), settings.s3.clone()));
    }
    if dests.is_empty() {
        return false;
    }
    settings.dests = dests;
    settings.archive_local = false;
    settings.archive_directory.clear();
    settings.s3_enabled = false;
    settings.s3 = S3Settings::default();
    true
}

pub fn dests_from_input(
    inputs: Vec<DestInput>,
    previous: &[StoredDest],
) -> Result<Vec<StoredDest>, String> {
    let mut dests = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (index, input) in inputs.into_iter().enumerate() {
        let id = if input.id.trim().is_empty() {
            new_dest_id(index as u128)
        } else {
            input.id.trim().to_string()
        };
        if !seen.insert(id.clone()) {
            return Err("archive-dest".to_string());
        }
        match input.kind.as_str() {
            "local" => {
                let directory = input.directory.trim();
                if directory.is_empty() {
                    return Err("archive-dir".to_string());
                }
                dests.push(StoredDest::local(id, directory));
            }
            "s3" => {
                let previous_secret = previous.iter().find_map(|dest| match dest {
                    StoredDest::S3 {
                        id: existing,
                        secret_access_key,
                        ..
                    } if existing == &id => Some(secret_access_key.clone()),
                    _ => None,
                });
                let secret = if input.secret_access_key.is_empty() {
                    previous_secret.unwrap_or_default()
                } else {
                    input.secret_access_key
                };
                dests.push(StoredDest::from_s3(
                    id,
                    S3Settings {
                        access_key_id: input.access_key_id,
                        secret_access_key: secret,
                        bucket_name: input.bucket_name,
                        region: input.region,
                        endpoint: input.endpoint,
                        path_style_access: input.path_style_access,
                        prefix: input.prefix,
                    },
                ));
            }
            _ => return Err("archive-dest".to_string()),
        }
    }
    Ok(dests)
}

#[derive(Clone, Debug)]
pub struct ReadyDest {
    pub id: String,
    pub dest: ArchiveDest,
}

impl ReadyDest {
    pub fn location(&self) -> String {
        self.dest.location()
    }
}

#[derive(Clone, Debug)]
pub enum ArchiveDest {
    Local(PathBuf),
    S3(S3Settings),
}

impl ArchiveDest {
    pub fn location(&self) -> String {
        match self {
            ArchiveDest::Local(path) => path.display().to_string(),
            ArchiveDest::S3(s3) => s3_repository(s3),
        }
    }
}

pub fn bucket_lookup(path_style: bool) -> &'static str {
    if path_style { "path" } else { "dns" }
}

/// HTTPS API host only. No path, query, user, or fragment.
pub fn validate_s3_endpoint(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("s3-endpoint".to_string());
    }
    let url = Url::parse(trimmed).map_err(|_| "s3-endpoint".to_string())?;
    if url.scheme() != "https" {
        return Err("s3-endpoint".to_string());
    }
    if url.username() != "" || url.password().is_some() {
        return Err("s3-endpoint".to_string());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("s3-endpoint".to_string());
    }
    if url.path() != "/" && !url.path().is_empty() {
        return Err("s3-endpoint".to_string());
    }
    if url.host_str().is_none() {
        return Err("s3-endpoint".to_string());
    }
    Ok(url.origin().ascii_serialization())
}

pub fn validate_archive_directory(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || !path.is_dir() {
        return Err("archive-dir".to_string());
    }
    Ok(path.to_path_buf())
}

pub fn reject_archive_inside_ledger(workdir: &Path, dest: &Path) -> Result<(), String> {
    if archive_nests_ledger(workdir, dest) {
        return Err("archive-nested".to_string());
    }
    Ok(())
}

pub fn archive_nests_ledger(workdir: &Path, dest: &Path) -> bool {
    let workdir = normalize_path(workdir);
    let dest = normalize_path(dest);
    dest == workdir || dest.starts_with(&workdir)
}

fn normalize_path(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }
    if let Some(parent) = path.parent()
        && let Ok(parent) = parent.canonicalize()
    {
        if let Some(name) = path.file_name() {
            return parent.join(name);
        }
        return parent;
    }
    path.to_path_buf()
}

pub fn s3_ready(s3: &S3Settings) -> Result<S3Settings, String> {
    let endpoint = validate_s3_endpoint(&s3.endpoint)?;
    if s3.access_key_id.trim().is_empty()
        || s3.secret_access_key.trim().is_empty()
        || s3.bucket_name.trim().is_empty()
    {
        return Err("s3-config".to_string());
    }
    Ok(S3Settings {
        access_key_id: s3.access_key_id.trim().to_string(),
        secret_access_key: s3.secret_access_key.clone(),
        bucket_name: s3.bucket_name.trim().to_string(),
        region: {
            let region = s3.region.trim();
            if region.is_empty() {
                "us-east-1".to_string()
            } else {
                region.to_string()
            }
        },
        endpoint,
        path_style_access: s3.path_style_access,
        prefix: s3.prefix.trim().trim_matches('/').to_string(),
    })
}

pub fn s3_repository(s3: &S3Settings) -> String {
    let bucket = if s3.prefix.is_empty() {
        s3.bucket_name.clone()
    } else {
        format!("{}/{}", s3.bucket_name, s3.prefix)
    };
    format!("s3:{}/{bucket}", s3.endpoint)
}

pub fn exclude_name(name: &str) -> bool {
    matches!(
        name,
        ".env" | ".backup_key" | ".DS_Store" | "Thumbs.db" | "desktop.ini" | "backups"
    ) || name.ends_with(".tmp")
        || name.ends_with('~')
}

pub fn collect_mtimes(directory: &Path) -> Result<Vec<(PathBuf, u64)>, String> {
    let mut times = Vec::new();
    for name in SNAPSHOT_PATHS {
        walk_mtimes(directory.join(name), &mut times)?;
    }
    Ok(times)
}

fn walk_mtimes(path: PathBuf, times: &mut Vec<(PathBuf, u64)>) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if exclude_name(name) {
        return Ok(());
    }
    if path.is_file() {
        let modified = fs_mtime(&path);
        times.push((path, modified));
        return Ok(());
    }
    if !path.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(&path).map_err(|error| error.to_string())? {
        walk_mtimes(entry.map_err(|error| error.to_string())?.path(), times)?;
    }
    Ok(())
}

fn fs_mtime(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_paths_are_the_ledger_trees() {
        assert_eq!(SNAPSHOT_PATHS, ["main.bean", "config", "data", "documents"]);
        assert_eq!(GIT_PATHS, ["main.bean", "config", "data"]);
        assert_eq!(bucket_lookup(true), "path");
        assert_eq!(bucket_lookup(false), "dns");
        assert_eq!(
            require_ledger(Path::new("relative")).err().as_deref(),
            Some("directory")
        );
    }

    #[test]
    fn directory_error_clears_once_the_ledger_file_exists() {
        let root = std::env::temp_dir().join(format!(
            "beandesk-clear-dir-err-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let mut last_error = Some("directory".to_string());
        clear_resolved_directory_error(&mut last_error, &root);
        assert_eq!(last_error.as_deref(), Some("directory"));
        std::fs::write(root.join("main.bean"), "option \"title\" \"Ledger\"\n").unwrap();
        clear_resolved_directory_error(&mut last_error, &root);
        assert_eq!(last_error, None);
        last_error = Some("missing".to_string());
        clear_resolved_directory_error(&mut last_error, &root);
        assert_eq!(last_error, None);
        last_error = Some("git".to_string());
        clear_resolved_directory_error(&mut last_error, &root);
        assert_eq!(last_error.as_deref(), Some("git"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn s3_endpoint_keeps_https_origin() {
        assert_eq!(
            validate_s3_endpoint("https://example.r2.cloudflarestorage.com/").unwrap(),
            "https://example.r2.cloudflarestorage.com"
        );
    }

    #[test]
    fn s3_endpoint_rejects_http_path_and_bucket_path() {
        assert_eq!(
            validate_s3_endpoint("http://minio.example:9000")
                .err()
                .as_deref(),
            Some("s3-endpoint")
        );
        assert_eq!(
            validate_s3_endpoint("https://example.r2.cloudflarestorage.com/my-bucket")
                .err()
                .as_deref(),
            Some("s3-endpoint")
        );
        assert_eq!(
            validate_s3_endpoint("https://example.r2.cloudflarestorage.com/?x=1")
                .err()
                .as_deref(),
            Some("s3-endpoint")
        );
    }

    #[test]
    fn s3_repository_uses_path_style_url() {
        let s3 = S3Settings {
            bucket_name: "books".to_string(),
            endpoint: "https://example.r2.cloudflarestorage.com".to_string(),
            prefix: "desk".to_string(),
            ..S3Settings::default()
        };
        assert_eq!(
            s3_repository(&s3),
            "s3:https://example.r2.cloudflarestorage.com/books/desk"
        );
        let bare = S3Settings {
            prefix: String::new(),
            ..s3
        };
        assert_eq!(
            s3_repository(&bare),
            "s3:https://example.r2.cloudflarestorage.com/books"
        );
    }

    #[test]
    fn exclude_list_skips_secrets_and_junk() {
        assert!(exclude_name(".env"));
        assert!(exclude_name(".backup_key"));
        assert!(exclude_name("backups"));
        assert!(exclude_name(".DS_Store"));
        assert!(!exclude_name("main.bean"));
        assert!(!exclude_name("2026-01.bean"));
    }

    #[test]
    fn watch_starts_for_git_or_archive_dests() {
        let mut settings = BackupSettings::default();
        assert!(settings.should_watch());
        settings.watch = false;
        assert!(!settings.should_watch());
        settings.archive_auto = true;
        assert!(!settings.archives_on_change());
        assert!(!settings.should_watch());
        settings.dests.push(StoredDest::local("one".into(), "/tmp"));
        assert!(settings.has_ready_archive_dest());
        assert!(settings.archives_on_change());
        assert!(settings.should_watch());
        settings.dests = vec![StoredDest::local(
            "gone".into(),
            &format!("/tmp/beandesk-missing-ready-{}", std::process::id()),
        )];
        assert!(!settings.has_ready_archive_dest());
        assert!(!settings.archives_on_change());
    }

    #[test]
    fn legacy_slots_move_into_dests_once() {
        let mut settings = BackupSettings {
            archive_local: true,
            archive_directory: "/tmp/out".into(),
            s3_enabled: true,
            s3: S3Settings {
                access_key_id: "ak".into(),
                secret_access_key: "sk".into(),
                bucket_name: "books".into(),
                endpoint: "https://example.r2.cloudflarestorage.com".into(),
                ..S3Settings::default()
            },
            ..BackupSettings::default()
        };
        assert!(migrate_legacy_dests(&mut settings));
        assert_eq!(settings.dests.len(), 2);
        assert!(!settings.archive_local);
        assert!(settings.archive_directory.is_empty());
        assert!(!settings.s3_enabled);
        assert!(settings.s3.secret_access_key.is_empty());
        assert!(!migrate_legacy_dests(&mut settings));
        assert_eq!(settings.dests.len(), 2);
        assert_eq!(
            settings
                .ready_dests()
                .iter()
                .filter(|dest| matches!(dest.dest, ArchiveDest::S3(_)))
                .count(),
            1
        );
    }

    #[test]
    fn dest_pulses_keep_a_snap_only_for_the_same_location() {
        let mut settings = BackupSettings::default();
        settings.dests = vec![StoredDest::local("local".into(), "/tmp/out")];
        settings.pending_checks = vec![settings.dests[0].location_key()];
        let pulses = dest_pulses(
            &settings,
            &[DestSnap {
                id: "local".into(),
                location: "/tmp/out".into(),
                last_snapshot: Some("abc".into()),
                last_snapshot_at: Some("2026-10-05T00:00:00Z".into()),
            }],
        );
        assert_eq!(pulses[0].last_snapshot.as_deref(), Some("abc"));
        assert!(settings.view().dests[0].check_failed);
        settings.dests = vec![StoredDest::local("local".into(), "/tmp/moved")];
        let moved = dest_pulses(
            &settings,
            &[DestSnap {
                id: "local".into(),
                location: "/tmp/out".into(),
                last_snapshot: Some("abc".into()),
                last_snapshot_at: Some("2026-10-05T00:00:00Z".into()),
            }],
        );
        assert!(moved[0].last_snapshot.is_none());
    }

    #[test]
    fn dests_keep_a_secret_when_the_input_omits_it() {
        let previous = vec![StoredDest::from_s3(
            "cloud".into(),
            S3Settings {
                secret_access_key: "kept".into(),
                access_key_id: "ak".into(),
                bucket_name: "books".into(),
                endpoint: "https://example.r2.cloudflarestorage.com".into(),
                ..S3Settings::default()
            },
        )];
        let next = dests_from_input(
            vec![DestInput {
                id: "cloud".into(),
                kind: "s3".into(),
                access_key_id: "ak2".into(),
                secret_access_key: String::new(),
                bucket_name: "books".into(),
                endpoint: "https://example.r2.cloudflarestorage.com".into(),
                path_style_access: true,
                ..empty_dest_input()
            }],
            &previous,
        )
        .unwrap();
        match &next[0] {
            StoredDest::S3 {
                secret_access_key,
                access_key_id,
                ..
            } => {
                assert_eq!(secret_access_key, "kept");
                assert_eq!(access_key_id, "ak2");
            }
            StoredDest::Local { .. } => panic!("expected s3"),
        }
    }

    fn empty_dest_input() -> DestInput {
        DestInput {
            id: String::new(),
            kind: String::new(),
            directory: String::new(),
            access_key_id: String::new(),
            secret_access_key: String::new(),
            bucket_name: String::new(),
            region: String::new(),
            endpoint: String::new(),
            path_style_access: true,
            prefix: String::new(),
        }
    }

    #[test]
    fn archive_directory_must_be_an_absolute_folder() {
        assert_eq!(
            validate_archive_directory(Path::new("relative"))
                .err()
                .as_deref(),
            Some("archive-dir")
        );
        let missing =
            std::env::temp_dir().join(format!("beandesk-missing-dest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&missing);
        assert_eq!(
            validate_archive_directory(&missing).err().as_deref(),
            Some("archive-dir")
        );
        std::fs::create_dir_all(&missing).unwrap();
        assert_eq!(validate_archive_directory(&missing).unwrap(), missing);
        let _ = std::fs::remove_dir_all(&missing);
    }

    #[test]
    fn archive_directory_cannot_sit_in_the_ledger() {
        let root = std::env::temp_dir().join(format!("beandesk-nest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("documents")).unwrap();
        assert!(archive_nests_ledger(&root, &root));
        assert!(archive_nests_ledger(&root, &root.join("documents")));
        assert!(!archive_nests_ledger(
            &root,
            &root.parent().unwrap().join("elsewhere")
        ));
        assert_eq!(
            reject_archive_inside_ledger(&root, &root.join("documents"))
                .err()
                .as_deref(),
            Some("archive-nested")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unknown_settings_fields_are_rejected() {
        let mut value = serde_json::to_value(BackupSettings::default()).unwrap();
        value
            .as_object_mut()
            .unwrap()
            .insert("keep".to_string(), serde_json::json!(30));
        assert!(serde_json::from_value::<BackupSettings>(value).is_err());
    }

    #[test]
    fn settings_round_trip() {
        let settings = BackupSettings {
            archive_auto: true,
            dests: vec![StoredDest::local("one".into(), "/tmp/out")],
            ..BackupSettings::default()
        };
        let parsed: BackupSettings =
            serde_json::from_value(serde_json::to_value(&settings).unwrap()).unwrap();
        assert!(parsed.archive_auto);
        assert_eq!(parsed.dests.len(), 1);
    }

    #[test]
    fn old_slot_files_still_deserialize() {
        let value = serde_json::json!({
            "watch": true,
            "debounceSecs": 5,
            "archiveAuto": false,
            "archiveLocal": true,
            "archiveDirectory": "/tmp/out",
            "s3Enabled": false,
            "s3": {
                "accessKeyId": "",
                "secretAccessKey": "",
                "bucketName": "",
                "region": "",
                "endpoint": "",
                "pathStyleAccess": true,
                "prefix": ""
            }
        });
        let parsed: BackupSettings = serde_json::from_value(value).unwrap();
        assert!(parsed.archive_local);
        assert!(parsed.dests.is_empty());
    }
}
