mod backup;
mod connection_log;
mod engine;
mod ledger_init;
mod mcp;
mod supervisor;

pub use mcp::{is_mcp_launch, run_mcp};

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use engine::{resolve_engine, sidecar_command};
use ledger_init::init_ledger_tree;
use supervisor::{HostSnapshot, Supervisor, accepts_local_origin};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_store::StoreExt;

const HANDBOOK_WINDOW: &str = "handbook";

pub(crate) const CONNECTION_FILE: &str = "connection.json";
pub(crate) const CONNECTION_KEY: &str = "connection";

struct FavaHost {
    supervisor: Mutex<Supervisor>,
}

#[derive(serde::Deserialize)]
struct SavedLocal {
    directory: String,
    command: String,
    origin: String,
    /// `engine` uses the bundled runtime even when `command` still holds the
    /// advanced-page shell line. Missing on files written before this field.
    #[serde(default)]
    launch: String,
}

fn bundled_launch(saved: &SavedLocal) -> bool {
    match saved.launch.as_str() {
        "engine" => true,
        "shell" => false,
        _ => saved.command.trim().is_empty(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_log::Builder::new().skip_logger().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            connection_log::install(app.handle())?;
            backup::start_if_enabled(app.handle());
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if webview.label() != HANDBOOK_WINDOW {
                return;
            }
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let window = webview.window();
            let _ = window.show();
            let _ = window.set_focus();
        })
        .manage(FavaHost {
            supervisor: Mutex::new(Supervisor::default()),
        })
        .manage(backup::BackupHost::default())
        .invoke_handler(tauri::generate_handler![
            start_saved_fava,
            stop_saved_fava,
            fava_host,
            init_ledger,
            start_if_enabled,
            read_user_text_file,
            mcp::mcp_host_config,
            system_locales,
            backup::load_backup_settings,
            backup::save_backup_settings,
            backup::backup_status,
            backup::backup_now,
            backup::backup_set_key,
            backup::backup_restore,
            backup::backup_snapshots,
            backup::backup_test_s3,
            backup::backup_open_workdir
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => shutdown(app),
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                if label == HANDBOOK_WINDOW {
                    api.prevent_close();
                    if let Some(win) = app.get_webview_window(&label) {
                        let _ = win.hide();
                    }
                } else if label == "main" {
                    if let Some(win) = app.get_webview_window(HANDBOOK_WINDOW) {
                        let _ = win.destroy();
                    }
                }
            }
            _ => {}
        });
}

fn shutdown(app: &AppHandle) {
    if let Some(host) = app.try_state::<FavaHost>() {
        lock(&host).stop();
    }
    backup::shutdown(app);
}

fn lock(host: &FavaHost) -> std::sync::MutexGuard<'_, Supervisor> {
    host.supervisor
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn connection_record(app: &AppHandle) -> Result<serde_json::Value, String> {
    let store = app
        .store(CONNECTION_FILE)
        .map_err(|error| error.to_string())?;
    store.reload().map_err(|error| error.to_string())?;
    store
        .get(CONNECTION_KEY)
        .ok_or_else(|| "missing".to_string())
}

pub(crate) fn saved_local(app: &AppHandle) -> Result<SavedLocal, String> {
    local_project(&connection_record(app)?)
}

/// Work folder from the saved local draft. Backup still uses it when `active`
/// is remote, because switching to connect-only keeps the local directory.
pub(crate) fn saved_workdir(app: &AppHandle) -> Result<PathBuf, String> {
    directory_from_connection(&connection_record(app)?)
}

pub(crate) fn directory_from_connection(value: &serde_json::Value) -> Result<PathBuf, String> {
    if let Some(directory) = value
        .get("local")
        .and_then(|local| local.get("directory"))
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        return Ok(PathBuf::from(directory));
    }
    Err("directory".to_string())
}

/// The active mode is the only one that can start a process.
fn local_project(value: &serde_json::Value) -> Result<SavedLocal, String> {
    if value.get("active").and_then(|item| item.as_str()) != Some("local") {
        return Err("not-local".to_string());
    }
    let local = value
        .get("local")
        .cloned()
        .ok_or_else(|| "missing".to_string())?;
    serde_json::from_value(local).map_err(|error| error.to_string())
}

/// Start the local project saved in the store. The command is not taken from
/// this call. If a process started earlier is still alive, keep it.
#[tauri::command]
fn start_saved_fava(app: AppHandle, host: State<'_, FavaHost>) -> Result<(), String> {
    let saved = saved_local(&app)?;
    if !accepts_local_origin(&saved.origin) {
        return Err("loopback".to_string());
    }
    let command = if bundled_launch(&saved) {
        let engine = resolve_engine(Some(&app))?;
        if let Err(code) = init_ledger_tree(Path::new(&saved.directory)) {
            if code != "ledger-exists" {
                return Err(code);
            }
        }
        sidecar_command(&engine, &saved.origin)?
    } else {
        saved.command
    };
    backup::start_if_enabled(&app);
    lock(&host).start(Path::new(&saved.directory), &command)
}

/// Stop the process group this window started.
#[tauri::command]
fn stop_saved_fava(host: State<'_, FavaHost>) {
    lock(&host).stop();
}

#[tauri::command]
fn fava_host(host: State<'_, FavaHost>) -> HostSnapshot {
    lock(&host).snapshot()
}

#[tauri::command]
fn init_ledger(app: AppHandle, directory: String) -> Result<(), String> {
    init_ledger_tree(Path::new(&directory))?;
    backup::start_if_enabled(&app);
    Ok(())
}

#[tauri::command]
fn start_if_enabled(app: AppHandle) {
    backup::start_if_enabled(&app);
}

/// Read a user-chosen absolute file. Used for a local ICS calendar.
/// This is not a general write path.
#[tauri::command]
fn read_user_text_file(path: String) -> Result<String, String> {
    read_user_text_file_at(Path::new(&path))
}

fn read_user_text_file_at(path: &Path) -> Result<String, String> {
    if !path.is_absolute() {
        return Err("path".into());
    }
    let meta = std::fs::metadata(path).map_err(|_| "file".to_string())?;
    if !meta.is_file() {
        return Err("file".into());
    }
    if meta.len() > 2 * 1024 * 1024 {
        return Err("too-large".into());
    }
    std::fs::read_to_string(path).map_err(|_| "file".to_string())
}

/// Preferred languages from the operating system. The webview's
/// `navigator.language` follows the app bundle, which is English until the
/// bundle itself is localized.
#[tauri::command]
fn system_locales() -> Vec<String> {
    sys_locale::get_locales()
        .filter(|tag| !tag.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{bundled_launch, directory_from_connection, local_project, read_user_text_file_at};

    #[test]
    fn reads_the_active_local_project() {
        let value = serde_json::json!({
            "active": "local",
            "local": {
                "directory": "/tmp/ledger",
                "command": "make run",
                "origin": "http://127.0.0.1:5000"
            },
            "remote": { "origin": "https://books.example" }
        });
        let saved = local_project(&value).unwrap();
        assert_eq!(saved.command, "make run");
        assert_eq!(saved.directory, "/tmp/ledger");
        assert!(!bundled_launch(&saved));
    }

    #[test]
    fn reads_a_local_project_with_an_empty_command() {
        let value = serde_json::json!({
            "active": "local",
            "local": {
                "directory": "/tmp/ledger",
                "command": "",
                "origin": "http://127.0.0.1:5000"
            },
            "remote": null
        });
        let saved = local_project(&value).unwrap();
        assert_eq!(saved.command, "");
        assert_eq!(saved.directory, "/tmp/ledger");
        assert!(bundled_launch(&saved));
    }

    #[test]
    fn engine_launch_ignores_a_saved_shell_command() {
        let value = serde_json::json!({
            "active": "local",
            "local": {
                "directory": "/tmp/ledger",
                "command": "make run",
                "origin": "http://127.0.0.1:5000",
                "launch": "engine"
            },
            "remote": null
        });
        let saved = local_project(&value).unwrap();
        assert_eq!(saved.command, "make run");
        assert!(bundled_launch(&saved));
    }

    #[test]
    fn backup_reads_the_local_folder_when_connect_only_is_active() {
        let value = serde_json::json!({
            "active": "remote",
            "local": {
                "directory": "/tmp/ledger",
                "command": "make run",
                "origin": "http://127.0.0.1:5000"
            },
            "remote": { "origin": "https://books.example" }
        });
        assert_eq!(
            directory_from_connection(&value).unwrap(),
            std::path::PathBuf::from("/tmp/ledger")
        );
    }

    #[test]
    fn backup_needs_a_local_folder() {
        let value = serde_json::json!({
            "active": "remote",
            "local": null,
            "remote": { "origin": "https://books.example" }
        });
        assert_eq!(
            directory_from_connection(&value).err().as_deref(),
            Some("directory")
        );
    }

    #[test]
    fn refuses_to_start_when_connect_only_is_active() {
        let value = serde_json::json!({
            "active": "remote",
            "local": {
                "directory": "/tmp/ledger",
                "command": "make run",
                "origin": "http://127.0.0.1:5000"
            },
            "remote": { "origin": "https://books.example" }
        });
        assert_eq!(local_project(&value).err().as_deref(), Some("not-local"));
    }

    #[test]
    fn reads_the_operating_system_languages() {
        let locales = super::system_locales();
        assert!(!locales.is_empty(), "expected at least one OS language");
        assert!(locales.iter().all(|tag| !tag.is_empty()));
    }

    #[test]
    fn reads_an_absolute_text_file() {
        let path = std::env::temp_dir().join(format!("beandesk-cal-{}.ics", std::process::id()));
        std::fs::write(&path, "BEGIN:VCALENDAR\n").unwrap();
        let text = read_user_text_file_at(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(text, "BEGIN:VCALENDAR\n");
    }

    #[test]
    fn refuses_a_relative_calendar_path() {
        assert_eq!(
            read_user_text_file_at(std::path::Path::new("calendar.ics"))
                .err()
                .as_deref(),
            Some("path")
        );
    }
}
