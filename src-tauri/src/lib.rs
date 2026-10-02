mod connection_log;
mod supervisor;

use std::path::Path;
use std::sync::Mutex;

use supervisor::{Supervisor, accepts_local_origin};
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_store::StoreExt;

const CONNECTION_FILE: &str = "connection.json";
const CONNECTION_KEY: &str = "connection";

struct FavaHost {
    supervisor: Mutex<Supervisor>,
}

#[derive(serde::Deserialize)]
struct SavedLocal {
    directory: String,
    command: String,
    origin: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::new().skip_logger().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            connection_log::install(app.handle())?;
            Ok(())
        })
        .manage(FavaHost {
            supervisor: Mutex::new(Supervisor::default()),
        })
        .invoke_handler(tauri::generate_handler![
            start_saved_fava,
            stop_saved_fava,
            fava_status,
            fava_installed,
            system_locales
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                shutdown(app);
            }
        });
}

fn shutdown(app: &AppHandle) {
    let Some(host) = app.try_state::<FavaHost>() else {
        return;
    };
    lock(&host).stop();
}

fn lock(host: &FavaHost) -> std::sync::MutexGuard<'_, Supervisor> {
    host.supervisor
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn saved_local(app: &AppHandle) -> Result<SavedLocal, String> {
    let store = app
        .store(CONNECTION_FILE)
        .map_err(|error| error.to_string())?;
    store.reload().map_err(|error| error.to_string())?;
    let value = store
        .get(CONNECTION_KEY)
        .ok_or_else(|| "missing".to_string())?;
    local_project(&value)
}

/// The active mode is the only one that can start a process. A file written
/// before `active` existed is still a single local or remote record.
fn local_project(value: &serde_json::Value) -> Result<SavedLocal, String> {
    if let Some(active) = value.get("active").and_then(|item| item.as_str()) {
        if active != "local" {
            return Err("not-local".to_string());
        }
        let local = value
            .get("local")
            .cloned()
            .ok_or_else(|| "missing".to_string())?;
        return serde_json::from_value(local).map_err(|error| error.to_string());
    }
    if value.get("kind").and_then(|kind| kind.as_str()) != Some("local") {
        return Err("not-local".to_string());
    }
    serde_json::from_value(value.clone()).map_err(|error| error.to_string())
}

/// Start the local project saved in the store. The command is not taken from
/// this call. If a process started earlier is still alive, keep it.
#[tauri::command]
fn start_saved_fava(app: AppHandle, host: State<'_, FavaHost>) -> Result<(), String> {
    let saved = saved_local(&app)?;
    if !accepts_local_origin(&saved.origin) {
        return Err("loopback".to_string());
    }
    lock(&host).start(Path::new(&saved.directory), &saved.command)
}

/// Stop the process group this window started.
#[tauri::command]
fn stop_saved_fava(host: State<'_, FavaHost>) {
    lock(&host).stop();
}

#[tauri::command]
fn fava_status(host: State<'_, FavaHost>) -> bool {
    lock(&host).running()
}

/// True when Fava is already on this machine: the saved ledger has a virtualenv
/// binary, or `fava` is on `PATH`. The quick-setup card stays hidden then.
#[tauri::command]
fn fava_installed(app: AppHandle) -> bool {
    if saved_directory(&app).is_some_and(|directory| fava_in_project(Path::new(&directory))) {
        return true;
    }
    executable_on_path("fava")
}

fn saved_directory(app: &AppHandle) -> Option<String> {
    let store = app.store(CONNECTION_FILE).ok()?;
    store.reload().ok()?;
    let value = store.get(CONNECTION_KEY)?;
    value
        .get("local")
        .and_then(|local| local.get("directory"))
        .and_then(|item| item.as_str())
        .or_else(|| value.get("directory").and_then(|item| item.as_str()))
        .map(str::to_string)
}

fn fava_in_project(directory: &Path) -> bool {
    directory.join(".venv/bin/fava").is_file() || directory.join(".venv/Scripts/fava.exe").is_file()
}

fn executable_on_path(name: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path)
        .any(|dir| dir.join(name).is_file() || dir.join(format!("{name}.exe")).is_file())
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
    use super::local_project;

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
    fn reads_a_local_record_written_before_active_existed() {
        let value = serde_json::json!({
            "kind": "local",
            "directory": "/tmp/ledger",
            "command": "make run",
            "origin": "http://127.0.0.1:5000"
        });
        let saved = local_project(&value).unwrap();
        assert_eq!(saved.origin, "http://127.0.0.1:5000");
    }

    #[test]
    fn a_project_venv_counts_as_fava_installed() {
        let root = std::env::temp_dir().join(format!("beandesk-fava-{}", std::process::id()));
        let bin = root.join(".venv/bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("fava"), b"#!/bin/sh\n").unwrap();
        assert!(super::fava_in_project(&root));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_the_operating_system_languages() {
        let locales = super::system_locales();
        assert!(!locales.is_empty(), "expected at least one OS language");
        assert!(locales.iter().all(|tag| !tag.is_empty()));
    }
}
