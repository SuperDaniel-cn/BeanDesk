use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use url::Url;

pub const SNAPSHOT_PATHS: [&str; 4] = ["main.bean", "config", "data", "documents"];

pub fn require_ledger(directory: &Path) -> Result<(), String> {
    if !directory.is_absolute() || !directory.is_dir() || !directory.join("main.bean").is_file() {
        return Err("directory".to_string());
    }
    Ok(())
}
pub const DEFAULT_KEEP: u32 = 30;
pub const DEFAULT_DEBOUNCE_SECS: u32 = 5;
pub const ARCHIVE_PREFIX: &str = "beandesk-backup-";
pub const ARCHIVE_SUFFIX: &str = ".tar.gz.enc";
pub const KEY_FILE: &str = ".backup_key";

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
    pub keep: u32,
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
            keep: DEFAULT_KEEP,
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
    pub keep: u32,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub last_git_at: Option<String>,
    pub last_git_hash: Option<String>,
    pub last_archive: Option<String>,
    pub last_upload: Option<String>,
    pub last_error: Option<String>,
    pub watching: bool,
    pub has_key: bool,
    pub archive_dir_ready: bool,
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
            keep: self.keep,
        }
    }

    pub fn has_archive_dest(&self) -> bool {
        self.archive_local || self.s3_enabled
    }

    pub fn archive_dir_ready(&self) -> bool {
        !self.archive_local || Path::new(self.archive_directory.trim()).is_dir()
    }

    pub fn archives_on_change(&self) -> bool {
        self.archive_auto && self.has_archive_dest()
    }

    pub fn should_watch(&self) -> bool {
        self.watch || self.archives_on_change()
    }
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

pub fn existing_file(path: Option<String>) -> Option<String> {
    path.filter(|path| Path::new(path).is_file())
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
                "auto".to_string()
            } else {
                region.to_string()
            }
        },
        endpoint,
        path_style_access: s3.path_style_access,
        prefix: s3.prefix.trim().trim_matches('/').to_string(),
    })
}

pub fn exclude_name(name: &str) -> bool {
    matches!(
        name,
        ".env" | ".backup_key" | ".DS_Store" | "Thumbs.db" | "desktop.ini" | "backups"
    ) || name.ends_with(".tmp")
        || name.ends_with('~')
}

pub fn is_archive_name(name: &str) -> bool {
    name.starts_with(ARCHIVE_PREFIX) && name.ends_with(ARCHIVE_SUFFIX)
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
        assert!(settings.archives_on_change());
        assert!(settings.should_watch());
        settings.archive_directory = "/tmp".to_string();
        assert!(settings.archive_dir_ready());
        settings.archive_directory = format!("/tmp/beandesk-missing-ready-{}", std::process::id());
        assert!(!settings.archive_dir_ready());
    }

    #[test]
    fn archive_directory_must_be_an_absolute_folder() {
        assert_eq!(
            validate_archive_directory(Path::new("relative")).err().as_deref(),
            Some("archive-dir")
        );
        assert_eq!(
            validate_archive_directory(Path::new("")).err().as_deref(),
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
    fn existing_file_drops_a_deleted_path() {
        let path = std::env::temp_dir().join(format!(
            "beandesk-stale-archive-{}.enc",
            std::process::id()
        ));
        std::fs::write(&path, b"cipher").unwrap();
        let shown = path.display().to_string();
        assert_eq!(existing_file(Some(shown.clone())).as_deref(), Some(shown.as_str()));
        std::fs::remove_file(&path).unwrap();
        assert_eq!(existing_file(Some(shown)), None);
        assert_eq!(existing_file(None), None);
    }

    #[test]
    fn archive_directory_cannot_sit_in_the_ledger() {
        let root = std::env::temp_dir().join(format!("beandesk-nest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("documents")).unwrap();
        assert!(archive_nests_ledger(&root, &root));
        assert!(archive_nests_ledger(&root, &root.join("documents")));
        assert!(archive_nests_ledger(&root, &root.join("beandesk-backup-1.tar.gz.enc")));
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
            .insert("nope".to_string(), serde_json::json!(true));
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
