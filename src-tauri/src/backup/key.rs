use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::settings::KEY_FILE;

pub fn key_path(directory: &Path) -> PathBuf {
    directory.join(KEY_FILE)
}

pub fn has_key(directory: &Path) -> bool {
    read_key(directory).is_ok()
}

pub fn write_key(directory: &Path, password: &str) -> Result<(), String> {
    if !directory.is_absolute() || !directory.is_dir() {
        return Err("directory".to_string());
    }
    let password = password.trim();
    if password.is_empty() {
        return Err("backup-key-missing".to_string());
    }
    let path = key_path(directory);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    file.write_all(password.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|error| error.to_string())
}

pub fn read_key(directory: &Path) -> Result<String, String> {
    let raw =
        fs::read_to_string(key_path(directory)).map_err(|_| "backup-key-missing".to_string())?;
    let line = raw.lines().next().unwrap_or("").trim_end_matches('\r');
    if line.is_empty() {
        return Err("backup-key-missing".to_string());
    }
    Ok(line.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("beandesk-key-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn empty_passphrase_is_not_a_key() {
        let root = scratch("empty");
        assert_eq!(
            write_key(&root, "   ").err().as_deref(),
            Some("backup-key-missing")
        );
        assert!(!key_path(&root).exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_then_read_keeps_the_first_line() {
        let root = scratch("round");
        write_key(&root, " hidden ").unwrap();
        assert_eq!(read_key(&root).unwrap(), "hidden");
        assert!(has_key(&root));
        let _ = fs::remove_dir_all(&root);
    }
}
