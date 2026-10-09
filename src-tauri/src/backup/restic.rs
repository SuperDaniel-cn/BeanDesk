use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use super::key::{
    has_key, key_path, next_key_path, read_key, read_secret_path, write_key, write_secret_path,
};
use super::settings::{
    ArchiveDest, BackupSettings, BackupSnapshot, CHECK_GROUPS, HOST, KEEP_WITHIN,
    KEEP_WITHIN_DAILY, KEEP_WITHIN_MONTHLY, KEEP_WITHIN_WEEKLY, ReadyDest, S3Settings,
    SNAPSHOT_PATHS, bucket_lookup, reject_archive_inside_ledger, require_ledger, s3_repository,
    validate_archive_directory,
};

#[derive(Clone, Debug)]
pub struct SnapshotWrite {
    pub id: String,
    pub dest_id: String,
    pub location: String,
}

fn restic_name() -> &'static str {
    if cfg!(windows) {
        "restic.exe"
    } else {
        "restic"
    }
}

pub fn resolve_restic(app: Option<&AppHandle>) -> Result<PathBuf, String> {
    let name = restic_name();
    let mut dirs = Vec::new();
    if let Some(handle) = app {
        if let Ok(path) = handle.path().resolve("restic", BaseDirectory::Resource) {
            dirs.push(path);
        }
    }
    dirs.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join("restic"),
    );

    for dir in dirs {
        let path = dir.join(name);
        if path.is_file() {
            return Ok(path);
        }
    }
    Err("missing-restic".to_string())
}

pub fn restic_ready(app: Option<&AppHandle>) -> bool {
    resolve_restic(app).is_ok()
}

struct Repo {
    binary: PathBuf,
    location: String,
    password_file: PathBuf,
    cache: PathBuf,
    env: Vec<(String, String)>,
    options: Vec<String>,
}

pub struct BackupOutcome {
    pub written: Vec<SnapshotWrite>,
    pub pending_checks: Vec<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSnapshots {
    pub dest_id: String,
    pub location: String,
    pub snapshots: Vec<BackupSnapshot>,
}

impl Repo {
    fn local(binary: PathBuf, directory: &Path, dest: &Path) -> Result<Self, String> {
        require_ledger(directory)?;
        let dest = validate_archive_directory(dest)?;
        reject_archive_inside_ledger(directory, &dest)?;
        if !has_key(directory) {
            return Err("backup-key-missing".to_string());
        }
        Ok(Self {
            binary,
            location: dest.to_string_lossy().into_owned(),
            password_file: key_path(directory),
            cache: dest.join(".restic-cache"),
            env: Vec::new(),
            options: Vec::new(),
        })
    }

    fn remote(binary: PathBuf, directory: &Path, s3: &S3Settings) -> Result<Self, String> {
        require_ledger(directory)?;
        if !has_key(directory) {
            return Err("backup-key-missing".to_string());
        }
        let location = s3_repository(s3);
        let cache =
            std::env::temp_dir().join(format!("beandesk-restic-{}", simple_hash(&location)));
        Ok(Self {
            binary,
            location,
            password_file: key_path(directory),
            cache,
            env: vec![
                ("AWS_ACCESS_KEY_ID".into(), s3.access_key_id.clone()),
                ("AWS_SECRET_ACCESS_KEY".into(), s3.secret_access_key.clone()),
                ("AWS_DEFAULT_REGION".into(), s3.region.clone()),
            ],
            options: vec![
                "-o".to_string(),
                format!("s3.bucket-lookup={}", bucket_lookup(s3.path_style_access)),
            ],
        })
    }

    fn from_dest(binary: PathBuf, directory: &Path, dest: &ArchiveDest) -> Result<Self, String> {
        match dest {
            ArchiveDest::Local(path) => Self::local(binary, directory, path),
            ArchiveDest::S3(s3) => Self::remote(binary, directory, s3),
        }
    }

    fn command(&self) -> Command {
        self.command_unlocked(&self.password_file)
    }

    fn command_unlocked(&self, password_file: &Path) -> Command {
        let mut command = Command::new(&self.binary);
        for option in &self.options {
            command.arg(option);
        }
        command
            .arg("-r")
            .arg(&self.location)
            .arg("--password-file")
            .arg(password_file)
            .arg("--cache-dir")
            .arg(&self.cache)
            .env("RESTIC_PROGRESS_FPS", "0")
            .stdin(Stdio::null());
        for (key, value) in &self.env {
            command.env(key, value);
        }
        command
    }

    fn passwd(&self, current: &Path, next: &Path) -> Result<(), String> {
        let output = self
            .command_unlocked(current)
            .args(["key", "passwd", "--new-password-file"])
            .arg(next)
            .output()
            .map_err(|_| "missing-restic".to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(map_restic(&output))
        }
    }

    fn config_code(&self, password_file: &Path) -> Result<Option<i32>, String> {
        let output = self
            .command_unlocked(password_file)
            .args(["cat", "config"])
            .output()
            .map_err(|_| "missing-restic".to_string())?;
        Ok(output.status.code())
    }

    fn run(&self, args: &[&str]) -> Result<Output, String> {
        let output = self
            .command()
            .args(args)
            .output()
            .map_err(|_| "missing-restic".to_string())?;
        Ok(output)
    }

    fn ensure(&self) -> Result<(), String> {
        let output = self.run(&["cat", "config"])?;
        match output.status.code() {
            Some(0) => Ok(()),
            Some(10) => self.init(),
            _ => Err(map_restic(&output)),
        }
    }

    fn init(&self) -> Result<(), String> {
        let output = self.run(&["init", "--json"])?;
        if output.status.success() {
            Ok(())
        } else {
            Err(map_restic(&output))
        }
    }
}

pub fn backup_dests(
    app: Option<&AppHandle>,
    directory: &Path,
    settings: &BackupSettings,
) -> BackupOutcome {
    if let Err(error) = finish_pending_rekey(app, directory, settings) {
        return BackupOutcome {
            written: Vec::new(),
            pending_checks: settings.pending_checks.clone(),
            error: Some(error),
        };
    }
    let dests = settings.ready_dests();
    if dests.is_empty() {
        return BackupOutcome {
            written: Vec::new(),
            pending_checks: settings.pending_checks.clone(),
            error: Some("archive-dest".to_string()),
        };
    }
    let binary = match resolve_restic(app) {
        Ok(binary) => binary,
        Err(error) => {
            return BackupOutcome {
                written: Vec::new(),
                pending_checks: settings.pending_checks.clone(),
                error: Some(error),
            };
        }
    };
    let mut written = Vec::new();
    let mut pending_checks = settings.pending_checks.clone();
    let mut last_error = None;
    for dest in dests {
        let location = dest.location();
        let pending = pending_checks.iter().any(|item| item == &location);
        match backup_one(&binary, directory, &dest, pending) {
            Ok(item) => {
                pending_checks.retain(|saved| saved != &location);
                if let Some(item) = item {
                    written.push(item);
                }
            }
            Err(error) => {
                if error == "check-pending"
                    && !pending_checks.iter().any(|saved| saved == &location)
                {
                    pending_checks.push(location);
                }
                last_error = Some(error);
            }
        }
    }
    BackupOutcome {
        written,
        pending_checks,
        error: last_error,
    }
}

fn backup_one(
    binary: &Path,
    directory: &Path,
    dest: &ReadyDest,
    pending: bool,
) -> Result<Option<SnapshotWrite>, String> {
    let repo = Repo::from_dest(binary.to_path_buf(), directory, &dest.dest)?;
    repo.ensure()?;
    let mut args = vec![
        "backup".to_string(),
        "--json".to_string(),
        "--host".to_string(),
        HOST.to_string(),
        "--skip-if-unchanged".to_string(),
        "--exclude".to_string(),
        ".DS_Store".to_string(),
        "--exclude".to_string(),
        "Thumbs.db".to_string(),
        "--exclude".to_string(),
        "desktop.ini".to_string(),
    ];
    for path in SNAPSHOT_PATHS {
        let abs = directory.join(path);
        if abs.is_file() || abs.is_dir() {
            args.push(path.to_string());
        }
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = repo
        .command()
        .current_dir(directory)
        .args(&arg_refs)
        .output()
        .map_err(|_| "missing-restic".to_string())?;
    let wrote = match output.status.code() {
        Some(0) => !backup_snapshot_id(&output.stdout).is_empty(),
        Some(3) => return Err("backup-partial".to_string()),
        _ => return Err(map_restic(&output)),
    };
    if wrote {
        forget(&repo)?;
    }
    if wrote || pending {
        check_subset(&repo)?;
    }
    if !wrote {
        return Ok(None);
    }
    Ok(Some(SnapshotWrite {
        id: backup_snapshot_id(&output.stdout),
        dest_id: dest.id.clone(),
        location: repo.location.clone(),
    }))
}

fn forget(repo: &Repo) -> Result<(), String> {
    let output = repo.run(&[
        "forget",
        "--json",
        "--host",
        HOST,
        "--keep-within",
        KEEP_WITHIN,
        "--keep-within-daily",
        KEEP_WITHIN_DAILY,
        "--keep-within-weekly",
        KEEP_WITHIN_WEEKLY,
        "--keep-within-monthly",
        KEEP_WITHIN_MONTHLY,
        "--prune",
    ])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(map_restic(&output))
    }
}

fn check_subset(repo: &Repo) -> Result<(), String> {
    let group = (unix_days() % u64::from(CHECK_GROUPS)) + 1;
    let subset = format!("{group}/{CHECK_GROUPS}");
    let output = repo.run(&["check", "--read-data-subset", &subset])?;
    if output.status.success() {
        Ok(())
    } else {
        Err("check-pending".to_string())
    }
}

pub fn list_snapshots(
    app: Option<&AppHandle>,
    directory: &Path,
    dest: &ArchiveDest,
) -> Result<Vec<BackupSnapshot>, String> {
    let repo = Repo::from_dest(resolve_restic(app)?, directory, dest)?;
    let output = repo.run(&["snapshots", "--json", "--host", HOST])?;
    match output.status.code() {
        Some(0) => parse_snapshots(&output.stdout),
        Some(10) => Ok(Vec::new()),
        _ => Err(map_restic(&output)),
    }
}

pub fn list_repos(
    app: Option<&AppHandle>,
    directory: &Path,
    settings: &BackupSettings,
) -> Result<Vec<RepoSnapshots>, String> {
    finish_pending_rekey(app, directory, settings)?;
    let dests = settings.ready_dests();
    if dests.is_empty() {
        return Ok(Vec::new());
    }
    let mut listed = Vec::new();
    let mut last_error = None;
    for dest in dests {
        match list_snapshots(app, directory, &dest.dest) {
            Ok(snapshots) => listed.push(RepoSnapshots {
                dest_id: dest.id.clone(),
                location: dest.location(),
                snapshots,
            }),
            Err(error) => last_error = Some(error),
        }
    }
    if listed.is_empty() {
        return Err(last_error.unwrap_or_else(|| "archive-dest".to_string()));
    }
    Ok(listed)
}

/// Rewrites the key of every repository that already exists. A repository that
/// does not exist yet stays uninitialized and picks up the new passphrase on the next backup.
pub fn rekey_existing(
    app: Option<&AppHandle>,
    directory: &Path,
    settings: &BackupSettings,
    new_password: &str,
) -> Result<(), String> {
    let new_password = new_password.trim();
    if new_password.is_empty() {
        return Err("backup-key-missing".to_string());
    }
    finish_pending_rekey(app, directory, settings)?;
    let old = read_key(directory).ok();
    let dests = settings.ready_dests();
    if old.as_deref() == Some(new_password) || dests.is_empty() || old.is_none() {
        return write_key(directory, new_password);
    }
    let binary = resolve_restic(app)?;
    let next = next_key_path(directory);
    write_secret_path(&next, new_password)?;
    let mut changed: Vec<ArchiveDest> = Vec::new();
    let result = (|| {
        for dest in dests {
            let repo = Repo::from_dest(binary.clone(), directory, &dest.dest)?;
            let output = repo.run(&["cat", "config"])?;
            match output.status.code() {
                Some(0) => {
                    repo.passwd(&repo.password_file, &next)?;
                    changed.push(dest.dest);
                }
                Some(10) => {}
                _ => return Err(map_restic(&output)),
            }
        }
        write_key(directory, new_password)
    })();
    if result.is_ok() {
        let _ = std::fs::remove_file(&next);
        return result;
    }
    let old_path = key_path(directory);
    let mut rolled = true;
    for dest in &changed {
        match Repo::from_dest(binary.clone(), directory, dest) {
            Ok(repo) => {
                if repo.passwd(&next, &old_path).is_err() {
                    rolled = false;
                }
            }
            Err(_) => rolled = false,
        }
    }
    if rolled {
        let _ = std::fs::remove_file(&next);
    }
    result
}

fn finish_pending_rekey(
    app: Option<&AppHandle>,
    directory: &Path,
    settings: &BackupSettings,
) -> Result<(), String> {
    let next = next_key_path(directory);
    if !next.is_file() {
        return Ok(());
    }
    let pending = match read_secret_path(&next) {
        Ok(value) => value,
        Err(_) => {
            let _ = std::fs::remove_file(&next);
            return Ok(());
        }
    };
    if read_key(directory).ok().as_deref() == Some(pending.as_str()) {
        let _ = std::fs::remove_file(&next);
        return Ok(());
    }
    let dests = settings.ready_dests();
    if dests.is_empty() {
        return Ok(());
    }
    let binary = resolve_restic(app)?;
    let old_path = key_path(directory);
    for dest in dests {
        let repo = Repo::from_dest(binary.clone(), directory, &dest.dest)?;
        match repo.config_code(&next)? {
            Some(0) | Some(10) => continue,
            _ => {}
        }
        if old_path.is_file() {
            match repo.config_code(&old_path)? {
                Some(0) => {
                    repo.passwd(&old_path, &next)?;
                    continue;
                }
                Some(10) => continue,
                _ => {}
            }
        }
        return Err("encrypt".to_string());
    }
    write_key(directory, &pending)?;
    let _ = std::fs::remove_file(&next);
    Ok(())
}

pub fn restore_snapshot(
    app: Option<&AppHandle>,
    directory: &Path,
    dest: &ArchiveDest,
    snapshot: &str,
    output: &Path,
) -> Result<(), String> {
    if snapshot.trim().is_empty() {
        return Err("snapshot".to_string());
    }
    check_restore_output(directory, output)?;
    let parent = output
        .parent()
        .filter(|path| path.is_dir())
        .ok_or_else(|| "directory".to_string())?;
    let staging = unique_staging(parent);
    std::fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let result = (|| {
        let repo = Repo::from_dest(resolve_restic(app)?, directory, dest)?;
        let target = format!("{snapshot}:.");
        let restored = repo
            .command()
            .args(["restore", &target, "--target"])
            .arg(&staging)
            .arg("--json")
            .output()
            .map_err(|_| "missing-restic".to_string())?;
        if !restored.status.success() {
            return Err(map_restic(&restored));
        }
        if output.exists() {
            std::fs::remove_dir(output).map_err(|_| "restore-not-empty".to_string())?;
        }
        std::fs::rename(&staging, output).map_err(|_| "restore-move".to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result
}

fn unique_staging(parent: &Path) -> PathBuf {
    let path = parent.join(format!(".beandesk-restore-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&path);
    path
}

fn check_restore_output(ledger: &Path, output: &Path) -> Result<(), String> {
    if !output.is_absolute() {
        return Err("directory".to_string());
    }
    if super::settings::same_path(ledger, output) {
        return Err("restore-nested".to_string());
    }
    if !output.exists() {
        return Ok(());
    }
    if !output.is_dir() {
        return Err("directory".to_string());
    }
    let empty = std::fs::read_dir(output)
        .map_err(|error| error.to_string())?
        .next()
        .is_none();
    if empty {
        Ok(())
    } else {
        Err("restore-not-empty".to_string())
    }
}

pub fn test_s3(app: Option<&AppHandle>, directory: &Path, s3: &S3Settings) -> Result<(), String> {
    let repo = Repo::remote(resolve_restic(app)?, directory, s3)?;
    repo.ensure()
}

fn backup_snapshot_id(stdout: &[u8]) -> String {
    for line in String::from_utf8_lossy(stdout).lines().rev() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value.get("message_type").and_then(|item| item.as_str()) != Some("summary") {
            continue;
        }
        return value
            .get("snapshot_id")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .chars()
            .take(8)
            .collect();
    }
    String::new()
}

#[derive(Deserialize)]
struct RawSnapshot {
    short_id: String,
    time: String,
}

fn parse_snapshots(stdout: &[u8]) -> Result<Vec<BackupSnapshot>, String> {
    let snaps: Vec<RawSnapshot> =
        serde_json::from_slice(stdout).map_err(|_| "restic".to_string())?;
    Ok(snaps
        .into_iter()
        .map(|item| BackupSnapshot {
            id: item.short_id,
            time: item.time,
        })
        .collect())
}

fn map_restic(output: &Output) -> String {
    let text = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{text}{}", String::from_utf8_lossy(&output.stdout));
    if combined.contains("wrong password") {
        return "encrypt".to_string();
    }
    if combined.contains("does not exist") || combined.contains("Is there a repository") {
        return "archive-dir".to_string();
    }
    match output.status.code() {
        Some(10) => "archive-dir".to_string(),
        Some(12) => "encrypt".to_string(),
        _ => "restic".to_string(),
    }
}

fn unix_days() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() / 86_400)
        .unwrap_or(0)
}

fn simple_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::key::write_key;
    use crate::backup::settings::StoredDest;
    use std::fs;

    fn scratch(name: &str) -> (PathBuf, PathBuf) {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "beandesk-restic-{name}-{}-{stamp}",
            std::process::id()
        ));
        let dest = std::env::temp_dir().join(format!(
            "beandesk-restic-{name}-dest-{}-{stamp}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&dest);
        fs::create_dir_all(root.join("config")).unwrap();
        fs::create_dir_all(root.join("data")).unwrap();
        fs::create_dir_all(root.join("documents/Assets")).unwrap();
        fs::create_dir_all(root.join("policies")).unwrap();
        fs::create_dir_all(&dest).unwrap();
        fs::write(root.join("main.bean"), "option \"title\" \"Ledger\"\n").unwrap();
        fs::write(root.join("config/accounts.bean"), "open Assets:Cash\n").unwrap();
        fs::write(root.join("documents/Assets/note.txt"), "keep").unwrap();
        fs::write(root.join("policies/README.md"), "# policy\n").unwrap();
        write_key(&root, "hidden").unwrap();
        (root, dest)
    }

    fn dest_settings(dest: &Path) -> BackupSettings {
        BackupSettings {
            dests: vec![StoredDest::local("one".into(), &dest.display().to_string())],
            ..BackupSettings::default()
        }
    }

    fn have_restic() -> bool {
        resolve_restic(None).is_ok()
    }

    #[test]
    fn restic_binary_name_is_stable() {
        if cfg!(windows) {
            assert_eq!(restic_name(), "restic.exe");
        } else {
            assert_eq!(restic_name(), "restic");
        }
    }

    #[test]
    fn backup_and_restore_round_trip() {
        if !have_restic() {
            return;
        }
        let (root, dest) = scratch("round");
        let settings = dest_settings(&dest);
        let written = backup_dests(None, &root, &settings);
        assert!(
            written.error.is_none(),
            "{}",
            written.error.unwrap_or_default()
        );
        assert_eq!(written.written.len(), 1);
        assert!(!written.written[0].id.is_empty());
        assert!(dest.join("config").is_file());
        let again = backup_dests(None, &root, &settings);
        assert!(again.error.is_none());
        assert!(again.written.is_empty());
        let snaps = list_snapshots(None, &root, &ArchiveDest::Local(dest.clone())).unwrap();
        assert!(!snaps.is_empty());
        let out = root.join("restored");
        restore_snapshot(
            None,
            &root,
            &ArchiveDest::Local(dest.clone()),
            &snaps.last().unwrap().id,
            &out,
        )
        .unwrap();
        assert!(out.join("main.bean").is_file());
        assert!(out.join("config/accounts.bean").is_file());
        assert!(out.join("documents/Assets/note.txt").is_file());
        assert!(out.join("policies/README.md").is_file());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn backup_stops_without_a_key() {
        if !have_restic() {
            return;
        }
        let (root, dest) = scratch("nokey");
        fs::remove_file(key_path(&root)).unwrap();
        let settings = dest_settings(&dest);
        assert_eq!(
            backup_dests(None, &root, &settings).error.as_deref(),
            Some("backup-key-missing")
        );
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn backup_refuses_the_ledger_tree() {
        if !have_restic() {
            return;
        }
        let (root, dest) = scratch("nested");
        let settings = dest_settings(&root);
        assert_eq!(
            backup_dests(None, &root, &settings).error.as_deref(),
            Some("archive-nested")
        );
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn backup_needs_a_destination() {
        let (root, dest) = scratch("nodest");
        let settings = BackupSettings::default();
        assert_eq!(
            backup_dests(None, &root, &settings).error.as_deref(),
            Some("archive-dest")
        );
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn a_new_passphrase_replaces_the_repository_key() {
        if !have_restic() {
            return;
        }
        let (root, dest) = scratch("rekey");
        let settings = dest_settings(&dest);
        assert!(backup_dests(None, &root, &settings).error.is_none());
        rekey_existing(None, &root, &settings, "other-pass").unwrap();
        assert_eq!(crate::backup::key::read_key(&root).unwrap(), "other-pass");
        let snaps = list_snapshots(None, &root, &ArchiveDest::Local(dest.clone())).unwrap();
        assert!(!snaps.is_empty());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn restore_refuses_the_ledger_tree_and_a_nonempty_folder() {
        let (root, dest) = scratch("restore-guard");
        assert_eq!(
            check_restore_output(&root, &root).err().as_deref(),
            Some("restore-nested")
        );
        assert_eq!(
            check_restore_output(&root, &root.join("documents"))
                .err()
                .as_deref(),
            Some("restore-not-empty")
        );
        assert_eq!(
            check_restore_output(&root, Path::new("relative"))
                .err()
                .as_deref(),
            Some("directory")
        );
        let elsewhere = root
            .parent()
            .unwrap()
            .join(format!("beandesk-restore-out-{}", std::process::id()));
        let _ = fs::remove_dir_all(&elsewhere);
        fs::create_dir_all(&elsewhere).unwrap();
        fs::write(elsewhere.join("keep.txt"), "keep").unwrap();
        assert_eq!(
            check_restore_output(&root, &elsewhere).err().as_deref(),
            Some("restore-not-empty")
        );
        let _ = fs::remove_dir_all(&elsewhere);
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn parses_a_summary_line() {
        let line = br#"{"message_type":"status"}
{"message_type":"summary","snapshot_id":"d21b5ab41d402f01"}"#;
        assert_eq!(backup_snapshot_id(line), "d21b5ab4");
        assert_eq!(backup_snapshot_id(br#"{"message_type":"summary"}"#), "");
    }
}
