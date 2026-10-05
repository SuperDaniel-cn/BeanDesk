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

use settings::DestSnap;

use key::has_key;
use restic::{backup_dests, list_repos, rekey_existing, restic_ready, restore_snapshot, test_s3};
use settings::ArchiveDest;
use watch::{SharedWatch, Watch};

const BACKUP_FILE: &str = "backup.json";
const BACKUP_KEY: &str = "backup";

pub struct BackupHost {
    watch: SharedWatch,
    status: Mutex<BackupStatus>,
    snapshot_cache: Mutex<SnapshotCache>,
}

#[derive(Clone, Default)]
struct SnapshotCache {
    fingerprint: String,
    dests: Vec<DestSnap>,
}

impl Default for BackupHost {
    fn default() -> Self {
        Self {
            watch: Arc::new(Mutex::new(Watch::default())),
            status: Mutex::new(BackupStatus::default()),
            snapshot_cache: Mutex::new(SnapshotCache::default()),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettingsInput {
    pub watch: bool,
    pub debounce_secs: u32,
    pub archive_auto: bool,
    #[serde(default)]
    pub dests: Vec<settings::DestInput>,
}

impl BackupSettingsInput {
    fn into_settings(self, previous: &BackupSettings) -> Result<BackupSettings, String> {
        Ok(BackupSettings {
            watch: self.watch,
            debounce_secs: self.debounce_secs.max(1),
            archive_auto: self.archive_auto,
            dests: settings::dests_from_input(self.dests, &previous.dests)?,
            pending_checks: previous.pending_checks.clone(),
            ..BackupSettings::default()
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3TestInput {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub bucket_name: String,
    pub region: String,
    pub endpoint: String,
    pub path_style_access: bool,
    pub prefix: String,
    #[serde(default)]
    pub dest_id: String,
}

pub fn load_settings(app: &AppHandle) -> BackupSettings {
    let Ok(store) = app.store(BACKUP_FILE) else {
        return BackupSettings::default();
    };
    let _ = store.reload();
    let mut settings = store
        .get(BACKUP_KEY)
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();
    if settings::migrate_legacy_dests(&mut settings) {
        let _ = save_settings(app, &settings);
    }
    settings
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
    if !crate::ledger_init::app_created_ledger(directory) || !settings.should_watch() {
        watch.stop();
        return;
    }
    let first = app.clone();
    let quiet = app.clone();
    watch.start(
        directory.to_path_buf(),
        settings.clone(),
        Arc::new(move |directory, settings| {
            if let Err(error) = apply_git(&first, &directory, &settings) {
                let host = first.state::<BackupHost>();
                set_status(&host, |status| status.last_error = Some(error));
            }
        }),
        Arc::new(move |directory, settings| run_watch_tick(&quiet, &directory, &settings)),
    );
}

/// Git only. First start and debounce ticks share this; it never writes restic dests.
/// Does not lock `host.watch`: `sync_watch` holds that lock while it joins this thread.
fn apply_git(app: &AppHandle, directory: &Path, settings: &BackupSettings) -> Result<(), String> {
    if !settings.watch {
        return Ok(());
    }
    let hash = git::snapshot(directory)?;
    let host = app.state::<BackupHost>();
    set_status(&host, |status| {
        if let Some(hash) = hash {
            status.last_git_at = Some(stamp());
            status.last_git_hash = Some(hash);
        }
    });
    Ok(())
}

/// Runs on the watcher thread after debounce. It must not lock `host.watch`.
fn run_watch_tick(app: &AppHandle, directory: &Path, settings: &BackupSettings) {
    let host = app.state::<BackupHost>();
    let mut failed = apply_git(app, directory, settings).err();
    if settings.archives_on_change() && has_key(directory) {
        match write_dests(app, directory, settings) {
            Ok(()) => {}
            Err(error) => failed = Some(error),
        }
    }
    set_status(&host, |status| status.last_error = failed);
}

fn write_dests(app: &AppHandle, directory: &Path, settings: &BackupSettings) -> Result<(), String> {
    let outcome = backup_dests(Some(app), directory, settings);
    if outcome.pending_checks != settings.pending_checks {
        let mut next = settings.clone();
        next.pending_checks = outcome.pending_checks.clone();
        let _ = save_settings(app, &next);
    }
    if !outcome.written.is_empty() {
        merge_written_snaps(app, &outcome.written, &stamp());
    } else if outcome.error.is_some() {
        if let Some(host) = app.try_state::<BackupHost>()
            && let Ok(mut cache) = host.snapshot_cache.lock()
        {
            cache.fingerprint.clear();
        }
    }
    if let Some(error) = outcome.error {
        return Err(error);
    }
    Ok(())
}

fn dest_fingerprint(settings: &BackupSettings) -> String {
    settings
        .ready_dests()
        .iter()
        .map(settings::ReadyDest::location)
        .collect::<Vec<_>>()
        .join("\n")
}

fn cached_dest_snaps(app: &AppHandle) -> Vec<DestSnap> {
    let Some(host) = app.try_state::<BackupHost>() else {
        return Vec::new();
    };
    host.snapshot_cache
        .lock()
        .map(|cache| cache.dests.clone())
        .unwrap_or_default()
}

fn merge_written_snaps(app: &AppHandle, written: &[restic::SnapshotWrite], at: &str) {
    let Some(host) = app.try_state::<BackupHost>() else {
        return;
    };
    let Ok(mut cache) = host.snapshot_cache.lock() else {
        return;
    };
    for item in written {
        if let Some(existing) = cache.dests.iter_mut().find(|dest| dest.id == item.dest_id) {
            existing.location = item.location.clone();
            existing.last_snapshot = Some(item.id.clone());
            existing.last_snapshot_at = Some(at.to_string());
        } else {
            cache.dests.push(DestSnap {
                id: item.dest_id.clone(),
                location: item.location.clone(),
                last_snapshot: Some(item.id.clone()),
                last_snapshot_at: Some(at.to_string()),
            });
        }
    }
}

fn snaps_from_repos(repos: &[restic::RepoSnapshots]) -> Vec<DestSnap> {
    repos
        .iter()
        .map(|repo| {
            let last = repo.snapshots.last();
            DestSnap {
                id: repo.dest_id.clone(),
                location: repo.location.clone(),
                last_snapshot: last.map(|item| item.id.clone()),
                last_snapshot_at: last.map(|item| item.time.clone()),
            }
        })
        .collect()
}

fn remember_listed(app: &AppHandle, settings: &BackupSettings, repos: &[restic::RepoSnapshots]) {
    let dests = snaps_from_repos(repos);
    let Some(host) = app.try_state::<BackupHost>() else {
        return;
    };
    if let Ok(mut cache) = host.snapshot_cache.lock() {
        cache.fingerprint = dest_fingerprint(settings);
        cache.dests = dests;
    }
}

fn require_app_ledger(directory: &Path) -> Result<(), String> {
    if crate::ledger_init::app_created_ledger(directory) {
        Ok(())
    } else {
        Err("foreign-ledger".to_string())
    }
}

fn run_backup(
    app: &AppHandle,
    directory: &Path,
    settings: &BackupSettings,
) -> Result<BackupStatus, String> {
    require_app_ledger(directory)?;
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
    status.app_ledger = crate::ledger_init::app_created_ledger(directory);
    status.has_ledger_file = directory.join("main.bean").is_file();
    status.watching = watching && status.app_ledger;
    settings::clear_resolved_directory_error(&mut status.last_error, directory);
    fill_snapshot_status(app, status, directory, settings);
}

fn fill_snapshot_status(
    app: &AppHandle,
    status: &mut BackupStatus,
    directory: &Path,
    settings: &BackupSettings,
) {
    if status_can_list(directory, settings, app) {
        let fingerprint = dest_fingerprint(settings);
        let hit = app.try_state::<BackupHost>().is_some_and(|host| {
            host.snapshot_cache
                .lock()
                .is_ok_and(|cache| cache.fingerprint == fingerprint && !fingerprint.is_empty())
        });
        if !hit {
            if let Ok(repos) = list_repos(Some(app), directory, settings) {
                remember_listed(app, settings, &repos);
            }
        }
    }
    let snaps = cached_dest_snaps(app);
    status.dests = settings::dest_pulses(settings, &snaps);
    let latest = status
        .dests
        .iter()
        .filter_map(|dest| Some((dest.last_snapshot.clone()?, dest.last_snapshot_at.clone()?)));
    match latest.max_by(|left, right| left.1.cmp(&right.1)) {
        Some((id, at)) => {
            status.last_snapshot = Some(id);
            status.last_snapshot_at = Some(at);
        }
        None => {
            status.last_snapshot = None;
            status.last_snapshot_at = None;
        }
    }
}

fn status_can_list(directory: &Path, settings: &BackupSettings, app: &AppHandle) -> bool {
    has_key(directory) && restic_ready(Some(app)) && !settings.ready_dests().is_empty()
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
        let mut settings = input.into_settings(&previous)?;
        let workdir = crate::saved_workdir(&app).ok();
        if settings.archive_auto && !workdir.as_ref().is_some_and(|directory| has_key(directory)) {
            settings.archive_auto = false;
        }
        if let Some(directory) = &workdir {
            settings.reject_nested_dests(directory)?;
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
        require_app_ledger(&directory)?;
        let settings = load_settings(&app);
        rekey_existing(Some(&app), &directory, &settings, &password)?;
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
        require_app_ledger(&directory)?;
        let settings = load_settings(&app);
        let target = restore_dest(&settings, &dest)?;
        restore_snapshot(
            Some(&app),
            &directory,
            &target,
            &snapshot,
            Path::new(&output),
        )?;
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
    let dest = dest.trim();
    if dest.is_empty() {
        return Err("archive-dest".to_string());
    }
    settings
        .ready_dests()
        .into_iter()
        .find(|item| item.location() == dest)
        .map(|item| item.dest)
        .ok_or_else(|| "archive-dest".to_string())
}

#[tauri::command]
pub async fn backup_snapshots(app: AppHandle) -> Result<Vec<restic::RepoSnapshots>, String> {
    spawn_heavy(move || {
        let directory = crate::saved_workdir(&app)?;
        require_app_ledger(&directory)?;
        let settings = load_settings(&app);
        list_repos(Some(&app), &directory, &settings)
    })
    .await
}

#[tauri::command]
pub async fn backup_test_s3(app: AppHandle, input: S3TestInput) -> Result<(), String> {
    spawn_heavy(move || {
        let directory = crate::saved_workdir(&app)?;
        require_app_ledger(&directory)?;
        let settings = load_settings(&app);
        let mut secret = input.secret_access_key;
        if secret.is_empty() && !input.dest_id.is_empty() {
            secret = settings
                .dests
                .iter()
                .find_map(|dest| match dest {
                    settings::StoredDest::S3 {
                        id,
                        secret_access_key,
                        ..
                    } if id == &input.dest_id => Some(secret_access_key.clone()),
                    _ => None,
                })
                .unwrap_or_default();
        }
        let s3 = settings::s3_ready(&S3Settings {
            access_key_id: input.access_key_id,
            secret_access_key: secret,
            bucket_name: input.bucket_name,
            region: input.region,
            endpoint: input.endpoint,
            path_style_access: input.path_style_access,
            prefix: input.prefix,
        })?;
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
            dests: vec![settings::DestInput {
                id: "cloud".into(),
                kind: "s3".into(),
                directory: String::new(),
                access_key_id: "ak".into(),
                secret_access_key: secret.into(),
                bucket_name: "b".into(),
                region: String::new(),
                endpoint: "https://example.r2.cloudflarestorage.com".into(),
                path_style_access: true,
                prefix: String::new(),
            }],
        }
    }

    #[test]
    fn empty_secret_keeps_the_saved_one() {
        let mut previous = BackupSettings::default();
        previous.dests = vec![settings::StoredDest::from_s3(
            "cloud".into(),
            S3Settings {
                secret_access_key: "kept".into(),
                ..S3Settings::default()
            },
        )];
        let next = input("").into_settings(&previous).unwrap();
        match &next.dests[0] {
            settings::StoredDest::S3 {
                secret_access_key,
                access_key_id,
                ..
            } => {
                assert_eq!(secret_access_key, "kept");
                assert_eq!(access_key_id, "ak");
            }
            settings::StoredDest::Local { .. } => panic!("expected s3"),
        }
        assert!(!next.archive_auto);
    }
}
