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
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BackupSettings {
    pub watch: bool,
    pub debounce_secs: u32,
    pub archive_auto: bool,
    pub archive_local: bool,
    pub archive_directory: String,
    pub s3_enabled: bool,
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
    pub archive_local: bool,
    pub archive_directory: String,
    pub s3_enabled: bool,
    pub access_key_id: String,
    pub bucket_name: String,
    pub region: String,
    pub endpoint: String,
    pub path_style_access: bool,
    pub prefix: String,
    pub secret_configured: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSnapshot {
    pub id: String,
    pub time: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub last_git_at: Option<String>,
    pub last_git_hash: Option<String>,
    pub last_snapshot: Option<String>,
    pub last_snapshot_at: Option<String>,
    pub last_upload: Option<String>,
    pub last_error: Option<String>,
    pub watching: bool,
    pub has_key: bool,
    pub restic_ready: bool,
    pub archive_dir_ready: bool,
    pub archive_directory: String,
}

impl BackupSettings {
    pub fn view(&self) -> BackupSettingsView {
        BackupSettingsView {
            watch: self.watch,
            debounce_secs: self.debounce_secs,
            archive_auto: self.archive_auto,
            archive_local: self.archive_local,
            archive_directory: self.archive_directory.clone(),
            s3_enabled: self.s3_enabled,
            access_key_id: self.s3.access_key_id.clone(),
            bucket_name: self.s3.bucket_name.clone(),
            region: self.s3.region.clone(),
            endpoint: self.s3.endpoint.clone(),
            path_style_access: self.s3.path_style_access,
            prefix: self.s3.prefix.clone(),
            secret_configured: !self.s3.secret_access_key.is_empty(),
        }
    }

    pub fn archive_dir_ready(&self) -> bool {
        !self.archive_local || Path::new(self.archive_directory.trim()).is_dir()
    }

    pub fn local_dest_ready(&self) -> bool {
        self.archive_local && Path::new(self.archive_directory.trim()).is_dir()
    }

    pub fn cloud_dest_ready(&self) -> bool {
        self.s3_enabled && s3_ready(&self.s3).is_ok()
    }

    pub fn has_ready_archive_dest(&self) -> bool {
        self.local_dest_ready() || self.cloud_dest_ready()
    }

    pub fn archives_on_change(&self) -> bool {
        self.archive_auto && self.has_ready_archive_dest()
    }

    pub fn should_watch(&self) -> bool {
        self.watch || self.archives_on_change()
    }

    pub fn ready_dests(&self) -> Vec<ArchiveDest> {
        let mut dests = Vec::new();
        if self.local_dest_ready() {
            dests.push(ArchiveDest::Local(PathBuf::from(self.archive_directory.trim())));
        }
        if let Ok(s3) = s3_ready(&self.s3)
            && self.s3_enabled
        {
            dests.push(ArchiveDest::S3(s3));
        }
        dests
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
        assert_eq!(
            SNAPSHOT_PATHS,
            ["main.bean", "config", "data", "documents"]
        );
        assert_eq!(GIT_PATHS, ["main.bean", "config", "data"]);
        assert_eq!(bucket_lookup(true), "path");
        assert_eq!(bucket_lookup(false), "dns");
        assert_eq!(
            require_ledger(Path::new("relative")).err().as_deref(),
            Some("directory")
        );
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
            validate_s3_endpoint("http://minio.example:9000").err().as_deref(),
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
        settings.archive_local = true;
        assert!(!settings.archives_on_change());
        assert!(!settings.should_watch());
        settings.archive_directory = "/tmp".to_string();
        assert!(settings.local_dest_ready());
        assert!(settings.archives_on_change());
        assert!(settings.should_watch());
        settings.archive_directory = format!("/tmp/beandesk-missing-ready-{}", std::process::id());
        assert!(!settings.archive_dir_ready());
        assert!(!settings.archives_on_change());
    }

    #[test]
    fn archive_directory_must_be_an_absolute_folder() {
        assert_eq!(
            validate_archive_directory(Path::new("relative")).err().as_deref(),
            Some("archive-dir")
        );
        let missing = std::env::temp_dir().join(format!(
            "beandesk-missing-dest-{}",
            std::process::id()
        ));
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
        assert!(!archive_nests_ledger(&root, &root.parent().unwrap().join("elsewhere")));
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
            archive_local: true,
            archive_directory: "/tmp/out".to_string(),
            ..BackupSettings::default()
        };
        let parsed: BackupSettings =
            serde_json::from_value(serde_json::to_value(&settings).unwrap()).unwrap();
        assert!(parsed.archive_auto);
        assert_eq!(parsed.archive_directory, "/tmp/out");
    }
}
