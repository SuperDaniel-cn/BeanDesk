use std::path::{Path, PathBuf};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

fn engine_exe_name() -> &'static str {
    if cfg!(windows) {
        "beandesk-engine.exe"
    } else {
        "beandesk-engine"
    }
}

fn looks_like_engine(path: &Path) -> bool {
    path.is_file() && path.with_file_name("_internal").is_dir()
}

pub fn resolve_engine(app: Option<&AppHandle>) -> Result<PathBuf, String> {
    let name = engine_exe_name();
    let mut dirs = Vec::new();
    if let Some(handle) = app {
        if let Ok(path) = handle.path().resolve("engine", BaseDirectory::Resource) {
            dirs.push(path);
        }
    }
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("engine"));

    for dir in dirs {
        let path = dir.join(name);
        if looks_like_engine(&path) {
            return Ok(path);
        }
    }
    Err("missing-engine".to_string())
}

pub fn port_from_origin(origin: &str) -> Result<u16, String> {
    let https = origin.starts_with("https://");
    let rest = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .ok_or_else(|| "loopback".to_string())?;
    if let Some(host) = rest.strip_prefix('[') {
        let (_, after) = host.split_once(']').ok_or_else(|| "loopback".to_string())?;
        return match after.strip_prefix(':') {
            Some(port) => port.parse().map_err(|_| "loopback".to_string()),
            None => Ok(if https { 443 } else { 80 }),
        };
    }
    if let Some((_, port)) = rest.rsplit_once(':') {
        if port.chars().all(|c| c.is_ascii_digit()) {
            return port.parse().map_err(|_| "loopback".to_string());
        }
    }
    Ok(if https { 443 } else { 80 })
}

pub fn sidecar_command(engine: &Path, origin: &str) -> Result<String, String> {
    let port = port_from_origin(origin)?;
    Ok(format!(
        "{} fava --host 127.0.0.1 --port {port} main.bean",
        shell_quote(&engine.to_string_lossy())
    ))
}

fn shell_quote(value: &str) -> String {
    if cfg!(windows) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exe_name_is_stable() {
        if cfg!(windows) {
            assert_eq!(engine_exe_name(), "beandesk-engine.exe");
        } else {
            assert_eq!(engine_exe_name(), "beandesk-engine");
        }
    }

    #[test]
    fn port_reads_the_origin() {
        assert_eq!(port_from_origin("http://127.0.0.1:5000").unwrap(), 5000);
        assert_eq!(port_from_origin("http://localhost").unwrap(), 80);
        assert_eq!(port_from_origin("https://[::1]").unwrap(), 443);
        assert_eq!(port_from_origin("http://[::1]:5001").unwrap(), 5001);
    }

    #[test]
    fn sidecar_command_quotes_the_engine_path() {
        let command = sidecar_command(Path::new("/tmp/engine"), "http://127.0.0.1:5000").unwrap();
        if cfg!(windows) {
            assert_eq!(
                command,
                "\"/tmp/engine\" fava --host 127.0.0.1 --port 5000 main.bean"
            );
        } else {
            assert_eq!(
                command,
                "'/tmp/engine' fava --host 127.0.0.1 --port 5000 main.bean"
            );
        }
    }

    #[test]
    fn a_lone_file_is_not_the_engine() {
        let root = std::env::temp_dir().join(format!("beandesk-lone-exe-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join(engine_exe_name());
        std::fs::write(&path, b"").unwrap();
        assert!(!looks_like_engine(&path));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_finds_a_dev_directory_when_present() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join("engine")
            .join(engine_exe_name());
        if looks_like_engine(&path) {
            assert_eq!(resolve_engine(None).unwrap(), path);
        } else {
            assert_eq!(resolve_engine(None).err().as_deref(), Some("missing-engine"));
        }
    }
}
