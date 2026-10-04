mod git;
mod key;
mod restic;
mod settings;
mod watch;

use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

use crate::engine::resolve_engine;

pub use settings::{BackupSettings, BackupSettingsView, BackupStatus, S3Settings};

use key::{has_key, write_key};
use restic::{backup_dests, list_snapshots, restore_snapshot, restic_ready, test_s3};
use settings::ArchiveDest;
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
        }
    }
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

async fn spawn_heavy<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
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
        Arc::new(move |directory, settings| run_watch_tick(&handle, &directory, &settings)),
    );
}

/// Runs on the watcher thread. It must not lock `host.watch`: `sync_watch` holds that lock while it joins this thread.
fn run_watch_tick(app: &AppHandle, directory: &Path, settings: &BackupSettings) {
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
    if settings.archives_on_change() && has_key(directory) {
        match write_dests(app, directory, settings) {
            Ok(()) => {}
            Err(error) => failed = Some(error),
        }
    }
    set_status(&host, |status| status.last_error = failed);
}

fn write_dests(app: &AppHandle, directory: &Path, settings: &BackupSettings) -> Result<(), String> {
    let host = app.state::<BackupHost>();
    let written = backup_dests(Some(app), directory, settings)?;
    set_status(&host, |status| {
        if let Some(item) = written.first() {
            status.last_snapshot = Some(item.id.clone());
            status.last_snapshot_at = Some(stamp());
        }
        if let Some(item) = written.iter().find(|item| item.cloud) {
            status.last_upload = Some(item.location.clone());
        }
    });
    Ok(())
}

fn run_backup(app: &AppHandle, directory: &Path, settings: &BackupSettings) -> Result<BackupStatus, String> {
    let host = app.state::<BackupHost>();
    match write_dests(app, directory, settings) {
        Ok(()) => {
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
        refresh_live_status(app, &mut status, directory, &settings, watching);
        return status;
    };
    refresh_live_status(app, &mut status, directory, &settings, watching);
    status.clone()
}

fn refresh_live_status(
    app: &AppHandle,
    status: &mut BackupStatus,
    directory: &Path,
    settings: &BackupSettings,
    watching: bool,
) {
    status.has_key = has_key(directory);
    status.restic_ready = restic_ready(Some(app));
    status.archive_dir_ready = settings.archive_dir_ready();
    status.archive_directory = settings.archive_directory.trim().to_string();
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

/// Off the main thread: stopping the watcher waits for a tick that may still be writing or uploading.
#[tauri::command]
pub async fn save_backup_settings(
    app: AppHandle,
    input: BackupSettingsInput,
) -> Result<BackupSettingsView, String> {
    spawn_heavy(move || {
        let previous = load_settings(&app);
        let mut settings = input.into_settings(&previous);
        let workdir = crate::saved_workdir(&app).ok();
        if settings.archive_auto && !workdir.as_ref().is_some_and(|directory| has_key(directory)) {
            settings.archive_auto = false;
        }
        let dest = settings.archive_directory.trim();
        if settings.archive_local && !dest.is_empty() && let Some(directory) = &workdir {
            settings::reject_archive_inside_ledger(directory, Path::new(dest))?;
        }
        save_settings(&app, &settings)?;
        if let Some(directory) = &workdir {
            sync_watch(&app, directory, &settings);
        }
        Ok(settings.view())
    })
    .await
}

#[tauri::command]
pub async fn backup_status(app: AppHandle) -> BackupStatus {
    spawn_heavy(move || {
        Ok(match crate::saved_workdir(&app) {
            Ok(directory) => current_status(&app, &directory),
            Err(_) => BackupStatus::default(),
        })
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn backup_now(app: AppHandle) -> Result<BackupStatus, String> {
    spawn_heavy(move || {
        let directory = crate::saved_workdir(&app)?;
        let settings = load_settings(&app);
        run_backup(&app, &directory, &settings)
    })
    .await
}

#[tauri::command]
pub async fn backup_set_key(app: AppHandle, password: String) -> Result<BackupStatus, String> {
    spawn_heavy(move || {
        let directory = crate::saved_workdir(&app)?;
        write_key(&directory, &password)?;
        Ok(current_status(&app, &directory))
    })
    .await
}

#[tauri::command]
pub async fn backup_restore(
    app: AppHandle,
    snapshot: String,
    output: String,
    dest: String,
) -> Result<(), String> {
    spawn_heavy(move || {
        let directory = crate::saved_workdir(&app)?;
        let settings = load_settings(&app);
        let target = restore_dest(&settings, &dest)?;
        restore_snapshot(Some(&app), &directory, &target, &snapshot, Path::new(&output))?;
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
    })
    .await
}

fn restore_dest(settings: &BackupSettings, dest: &str) -> Result<ArchiveDest, String> {
    let dests = settings.ready_dests();
    if dests.is_empty() {
        return Err("archive-dest".to_string());
    }
    if dest.trim().is_empty() {
        return dests.into_iter().next().ok_or_else(|| "archive-dest".to_string());
    }
    dests
        .into_iter()
        .find(|item| match item {
            ArchiveDest::Local(path) => path.display().to_string() == dest,
            ArchiveDest::S3(s3) => settings::s3_repository(s3) == dest,
        })
        .ok_or_else(|| "archive-dest".to_string())
}

#[tauri::command]
pub async fn backup_snapshots(app: AppHandle) -> Result<Vec<settings::BackupSnapshot>, String> {
    spawn_heavy(move || {
        let directory = crate::saved_workdir(&app)?;
        let settings = load_settings(&app);
        let Some(dest) = settings.ready_dests().into_iter().next() else {
            return Ok(Vec::new());
        };
        list_snapshots(Some(&app), &directory, &dest)
    })
    .await
}

#[tauri::command]
pub async fn backup_test_s3(app: AppHandle) -> Result<(), String> {
    spawn_heavy(move || {
        let directory = crate::saved_workdir(&app)?;
        let settings = load_settings(&app);
        let s3 = settings::s3_ready(&settings.s3)?;
        test_s3(Some(&app), &directory, &s3)
    })
    .await
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
}
