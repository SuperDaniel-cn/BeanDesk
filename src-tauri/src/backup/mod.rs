mod archive;
mod git;
mod s3;
mod settings;
mod watch;

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

use crate::engine::resolve_engine;

pub use settings::{BackupSettings, BackupSettingsView, BackupStatus, S3Settings};

use archive::{
    archive_filename, export_encrypted_archive, has_key, restore_archive, write_cipher,
    write_encrypted_archive, write_key,
};
use watch::{SharedWatch, Watch};

const BACKUP_FILE: &str = "backup.json";
const BACKUP_KEY: &str = "backup";

pub struct BackupHost {
    watch: SharedWatch,
    status: Mutex<BackupStatus>,
}

impl Default for BackupHost {
    fn default() -> Self {
        Self {
            watch: Arc::new(Mutex::new(Watch::default())),
            status: Mutex::new(BackupStatus::default()),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettingsInput {
    pub watch: bool,
    pub debounce_secs: u32,
    pub archive_auto: bool,
    pub archive_local: bool,
    pub archive_directory: String,
    pub s3_enabled: bool,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub bucket_name: String,
    pub region: String,
    pub endpoint: String,
    pub path_style_access: bool,
    pub prefix: String,
    pub keep: u32,
}

impl BackupSettingsInput {
    fn into_settings(self, previous: &BackupSettings) -> BackupSettings {
        BackupSettings {
            watch: self.watch,
            debounce_secs: self.debounce_secs.max(1),
            archive_auto: self.archive_auto,
            archive_local: self.archive_local,
            archive_directory: self.archive_directory,
            s3_enabled: self.s3_enabled,
            s3: S3Settings {
                access_key_id: self.access_key_id,
                secret_access_key: if self.secret_access_key.is_empty() {
                    previous.s3.secret_access_key.clone()
                } else {
                    self.secret_access_key
                },
                bucket_name: self.bucket_name,
                region: self.region,
                endpoint: self.endpoint,
                path_style_access: self.path_style_access,
                prefix: self.prefix,
            },
            keep: self.keep.max(1),
        }
    }
}

struct ArchiveOutcome {
    archive: Option<String>,
    upload: Option<String>,
}

pub fn load_settings(app: &AppHandle) -> BackupSettings {
    let Ok(store) = app.store(BACKUP_FILE) else {
        return BackupSettings::default();
    };
    let _ = store.reload();
    store
        .get(BACKUP_KEY)
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &BackupSettings) -> Result<(), String> {
    let store = app.store(BACKUP_FILE).map_err(|error| error.to_string())?;
    store.set(
        BACKUP_KEY,
        serde_json::to_value(settings).map_err(|error| error.to_string())?,
    );
    store.save().map_err(|error| error.to_string())
}

fn set_status(host: &BackupHost, update: impl FnOnce(&mut BackupStatus)) {
    if let Ok(mut status) = host.status.lock() {
        update(&mut status);
    }
}

fn fail(host: &BackupHost, error: String) -> Result<BackupStatus, String> {
    set_status(host, |status| status.last_error = Some(error.clone()));
    Err(error)
}

fn stamp() -> String {
    let now = time::OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    )
}

pub fn start_if_enabled(app: &AppHandle) {
    let settings = load_settings(app);
    let Ok(directory) = crate::saved_workdir(app) else {
        return;
    };
    sync_watch(app, &directory, &settings);
}

fn sync_watch(app: &AppHandle, directory: &Path, settings: &BackupSettings) {
    let Some(host) = app.try_state::<BackupHost>() else {
        return;
    };
    let Ok(mut watch) = host.watch.lock() else {
        return;
    };
    if !settings.should_watch() {
        watch.stop();
        return;
    }
    let handle = app.clone();
    watch.start(
        directory.to_path_buf(),
        settings.clone(),
        Arc::new(move |directory, settings| {
            let _ = run_watch_tick(&handle, &directory, &settings);
        }),
    );
}

fn run_watch_tick(
    app: &AppHandle,
    directory: &Path,
    settings: &BackupSettings,
) -> Result<BackupStatus, String> {
    let host = app.state::<BackupHost>();
    let mut failed = None;
    if settings.watch {
        match git::snapshot(directory) {
            Ok(hash) => set_status(&host, |status| {
                if let Some(hash) = hash {
                    status.last_git_at = Some(stamp());
                    status.last_git_hash = Some(hash);
                }
            }),
            Err(error) => failed = Some(error),
        }
    }
    if settings.archives_on_change() {
        match write_and_upload(directory, settings) {
            Ok(outcome) => apply_archive_outcome(&host, outcome),
            Err(error) => failed = Some(error),
        }
    }
    if let Some(error) = failed {
        return fail(&host, error);
    }
    set_status(&host, |status| status.last_error = None);
    Ok(current_status(app, directory))
}

fn apply_archive_outcome(host: &BackupHost, outcome: ArchiveOutcome) {
    set_status(host, |status| {
        if let Some(path) = outcome.archive {
            status.last_archive = Some(path);
        }
        if let Some(key) = outcome.upload {
            status.last_upload = Some(key);
        }
    });
}

fn write_and_upload(directory: &Path, settings: &BackupSettings) -> Result<ArchiveOutcome, String> {
    if !settings.has_archive_dest() {
        return Err("archive-dest".to_string());
    }
    let s3 = if settings.s3_enabled {
        Some(settings::s3_ready(&settings.s3)?)
    } else {
        None
    };

    let local_path = if settings.archive_local {
        Some(write_encrypted_archive(
            directory,
            Path::new(settings.archive_directory.trim()),
            settings.keep,
        )?)
    } else {
        None
    };

    let upload = match s3 {
        Some(s3) => {
            let (path, ephemeral) = match &local_path {
                Some(path) => (path.clone(), false),
                None => {
                    let tmp = std::env::temp_dir().join(archive_filename());
                    write_cipher(directory, &tmp)?;
                    (tmp, true)
                }
            };
            let uploaded = s3::upload_archive(&s3, &path, settings.keep);
            if ephemeral {
                let _ = fs::remove_file(&path);
            }
            Some(uploaded?)
        }
        None => None,
    };

    Ok(ArchiveOutcome {
        archive: local_path.map(|path| path.display().to_string()),
        upload,
    })
}

fn run_archive(
    app: &AppHandle,
    directory: &Path,
    settings: &BackupSettings,
) -> Result<BackupStatus, String> {
    let host = app.state::<BackupHost>();
    match write_and_upload(directory, settings) {
        Ok(outcome) => {
            apply_archive_outcome(&host, outcome);
            set_status(&host, |status| status.last_error = None);
            Ok(current_status(app, directory))
        }
        Err(error) => fail(&host, error),
    }
}

fn current_status(app: &AppHandle, directory: &Path) -> BackupStatus {
    let host = app.state::<BackupHost>();
    let settings = load_settings(app);
    let watching = host
        .watch
        .lock()
        .map(|watch| watch.running())
        .unwrap_or(false);
    let Ok(mut status) = host.status.lock() else {
        let mut status = BackupStatus::default();
        refresh_live_status(&mut status, directory, &settings, watching);
        return status;
    };
    refresh_live_status(&mut status, directory, &settings, watching);
    status.clone()
}

fn refresh_live_status(
    status: &mut BackupStatus,
    directory: &Path,
    settings: &BackupSettings,
    watching: bool,
) {
    status.has_key = has_key(directory);
    status.archive_dir_ready = settings.archive_dir_ready();
    status.last_archive = settings::existing_file(status.last_archive.take());
    status.watching = watching;
}

pub fn shutdown(app: &AppHandle) {
    if let Some(host) = app.try_state::<BackupHost>()
        && let Ok(mut watch) = host.watch.lock()
    {
        watch.stop();
    }
}

#[tauri::command]
pub fn load_backup_settings(app: AppHandle) -> BackupSettingsView {
    load_settings(&app).view()
}

#[tauri::command]
pub fn save_backup_settings(app: AppHandle, input: BackupSettingsInput) -> Result<BackupSettingsView, String> {
    let previous = load_settings(&app);
    let mut settings = input.into_settings(&previous);
    let workdir = crate::saved_workdir(&app).ok();
    if settings.archive_auto && !workdir.as_ref().is_some_and(|directory| has_key(directory)) {
        settings.archive_auto = false;
    }
    if settings.archive_local && let Some(directory) = &workdir {
        settings::reject_archive_inside_ledger(
            directory,
            Path::new(settings.archive_directory.trim()),
        )?;
    }
    save_settings(&app, &settings)?;
    if let Some(directory) = &workdir {
        sync_watch(&app, directory, &settings);
    }
    Ok(settings.view())
}

#[tauri::command]
pub fn backup_status(app: AppHandle) -> BackupStatus {
    match crate::saved_workdir(&app) {
        Ok(directory) => current_status(&app, &directory),
        Err(_) => BackupStatus::default(),
    }
}

#[tauri::command]
pub fn backup_now(app: AppHandle) -> Result<BackupStatus, String> {
    let directory = crate::saved_workdir(&app)?;
    let settings = load_settings(&app);
    run_archive(&app, &directory, &settings)
}

#[tauri::command]
pub fn backup_export(app: AppHandle, dest: String) -> Result<BackupStatus, String> {
    let directory = crate::saved_workdir(&app)?;
    let host = app.state::<BackupHost>();
    match export_encrypted_archive(&directory, Path::new(&dest)) {
        Ok(path) => {
            set_status(&host, |status| {
                status.last_error = None;
                status.last_archive = Some(path.display().to_string());
            });
            Ok(current_status(&app, &directory))
        }
        Err(error) => fail(&host, error),
    }
}

#[tauri::command]
pub fn backup_set_key(app: AppHandle, password: String) -> Result<BackupStatus, String> {
    let directory = crate::saved_workdir(&app)?;
    write_key(&directory, &password)?;
    Ok(current_status(&app, &directory))
}

#[tauri::command]
pub fn backup_restore(app: AppHandle, archive: String, output: String) -> Result<(), String> {
    let directory = crate::saved_workdir(&app)?;
    let password = archive::read_key(&directory)?;
    restore_archive(Path::new(&archive), Path::new(&output), &password)?;
    let ledger = Path::new(&output).join("main.bean");
    if !ledger.is_file() {
        return Err("encrypt".to_string());
    }
    let engine = resolve_engine(Some(&app))?;
    let status = std::process::Command::new(&engine)
        .arg("check")
        .arg(&ledger)
        .current_dir(&output)
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("check".to_string())
    }
}

#[tauri::command]
pub fn backup_test_s3(app: AppHandle) -> Result<(), String> {
    let settings = load_settings(&app);
    let s3 = settings::s3_ready(&settings.s3)?;
    s3::test_access(&s3)
}

#[tauri::command]
pub fn backup_open_workdir(app: AppHandle) -> Result<(), String> {
    open_folder(&crate::saved_workdir(&app)?)
}

fn open_folder(directory: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(directory)
            .status()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(directory)
            .status()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(directory)
            .status()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn ledger_with_dest(name: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("beandesk-{name}-{}", std::process::id()));
        let dest = std::env::temp_dir().join(format!("beandesk-{name}-dest-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&dest);
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&dest).unwrap();
        fs::write(root.join("main.bean"), "option \"title\" \"Ledger\"\n").unwrap();
        archive::write_key(&root, "hidden").unwrap();
        (root, dest)
    }

    fn input(secret: &str) -> BackupSettingsInput {
        BackupSettingsInput {
            watch: true,
            debounce_secs: 5,
            archive_auto: false,
            archive_local: false,
            archive_directory: String::new(),
            s3_enabled: false,
            access_key_id: "ak".to_string(),
            secret_access_key: secret.to_string(),
            bucket_name: "b".to_string(),
            region: String::new(),
            endpoint: String::new(),
            path_style_access: true,
            prefix: String::new(),
            keep: 30,
        }
    }

    #[test]
    fn empty_secret_keeps_the_saved_one() {
        let mut previous = BackupSettings::default();
        previous.s3.secret_access_key = "kept".to_string();
        let next = input("").into_settings(&previous);
        assert_eq!(next.s3.secret_access_key, "kept");
        assert_eq!(next.s3.access_key_id, "ak");
        assert!(!next.archive_auto);
    }

    #[test]
    fn archive_without_a_destination_stops_before_writing() {
        let (root, dest) = ledger_with_dest("nodest");
        let _ = fs::remove_dir_all(&dest);
        let mut settings = BackupSettings::default();
        settings.archive_auto = true;
        assert_eq!(
            write_and_upload(&root, &settings).err().as_deref(),
            Some("archive-dest")
        );
        settings.archive_local = true;
        assert_eq!(
            write_and_upload(&root, &settings).err().as_deref(),
            Some("archive-dir")
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn archive_stops_after_the_key_is_deleted() {
        let (root, dest) = ledger_with_dest("mod-keygone");
        let mut settings = BackupSettings::default();
        settings.archive_local = true;
        settings.archive_directory = dest.display().to_string();
        write_and_upload(&root, &settings).unwrap();
        fs::remove_file(archive::key_path(&root)).unwrap();
        assert_eq!(
            write_and_upload(&root, &settings).err().as_deref(),
            Some("backup-key-missing")
        );
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn archive_stops_after_the_dest_folder_is_deleted() {
        let (root, dest) = ledger_with_dest("destgone");
        let mut settings = BackupSettings::default();
        settings.archive_local = true;
        settings.archive_directory = dest.display().to_string();
        write_and_upload(&root, &settings).unwrap();
        fs::remove_dir_all(&dest).unwrap();
        assert_eq!(
            write_and_upload(&root, &settings).err().as_deref(),
            Some("archive-dir")
        );
        assert!(!dest.exists());
        let _ = fs::remove_dir_all(&root);
    }
}
