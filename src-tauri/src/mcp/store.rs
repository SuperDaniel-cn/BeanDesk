use std::path::{Path, PathBuf};

use crate::{CONNECTION_FILE, CONNECTION_KEY};

const APP_IDENTIFIER: &str = "app.beandesk.desktop";

fn default_store_path() -> Result<PathBuf, String> {
    dirs::data_dir()
        .map(|dir| dir.join(APP_IDENTIFIER).join(CONNECTION_FILE))
        .ok_or_else(|| "missing".to_string())
}

fn read_store_file(path: &Path) -> Result<serde_json::Value, String> {
    let text = std::fs::read_to_string(path).map_err(|_| "missing".to_string())?;
    serde_json::from_str(&text).map_err(|_| "missing".to_string())
}

pub(crate) fn connection_value(store: &serde_json::Value) -> Result<&serde_json::Value, String> {
    store
        .get(CONNECTION_KEY)
        .ok_or_else(|| "missing".to_string())
}

pub(crate) fn load_saved_connection() -> Result<serde_json::Value, String> {
    let store = read_store_file(&default_store_path()?)?;
    connection_value(&store).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_path_uses_the_desktop_identifier() {
        let path = default_store_path().unwrap();
        assert!(path.ends_with(Path::new("app.beandesk.desktop/connection.json")));
    }

    #[test]
    fn connection_value_reads_the_settings_key() {
        let store = serde_json::json!({
            "connection": { "active": "remote" },
            "suspended": false
        });
        assert_eq!(connection_value(&store).unwrap()["active"], "remote");
        assert_eq!(
            connection_value(&serde_json::json!({})).err().as_deref(),
            Some("missing")
        );
    }
}
