use std::fs;
use std::io::Write;
use std::path::Path;

use time::OffsetDateTime;

const SAMPLE_ACCOUNTS: &str = "\
2020-01-01 open Assets:Bank:Checking CNY
2020-01-01 open Liabilities:Owner:Advance CNY
2020-01-01 open Equity:Capital CNY
2020-01-01 open Income:Services:Delivery CNY
2020-01-01 open Income:Services:Advice CNY
2020-01-01 open Expenses:Operations:Hosting CNY
";

pub fn init_ledger_tree(directory: &Path) -> Result<(), String> {
    if !directory.is_absolute() || !directory.is_dir() {
        return Err("directory".to_string());
    }
    if directory.join("main.bean").exists() {
        return Err("ledger-exists".to_string());
    }
    if !effectively_empty(directory)? {
        return Err("not-empty".to_string());
    }

    let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    let year = now.year();
    let month = u8::from(now.month());
    let year_dir = directory.join("data").join(year.to_string());
    fs::create_dir_all(directory.join("config")).map_err(|error| error.to_string())?;
    fs::create_dir_all(&year_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(directory.join("documents")).map_err(|error| error.to_string())?;

    let month_file = format!("{year}-{month:02}.bean");
    let main = format!(
        "option \"title\" \"Ledger\"\n\
         option \"operating_currency\" \"CNY\"\n\
         option \"documents\" \"documents\"\n\
         include \"config/accounts.bean\"\n\
         include \"data/{year}/{year}.bean\"\n"
    );
    let year_index = format!("include \"{month_file}\"\n");

    write_new(directory.join("main.bean"), &main)?;
    write_new(directory.join("config/accounts.bean"), SAMPLE_ACCOUNTS)?;
    write_new(year_dir.join(format!("{year}.bean")), &year_index)?;
    write_new(year_dir.join(&month_file), "")?;
    Ok(())
}

fn effectively_empty(directory: &Path) -> Result<bool, String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let name = entry.map_err(|error| error.to_string())?.file_name();
        let name = name.to_string_lossy();
        if name == ".DS_Store" || name == "Thumbs.db" || name == "desktop.ini" {
            continue;
        }
        return Ok(false);
    }
    Ok(true)
}

fn write_new(path: impl AsRef<Path>, contents: &str) -> Result<(), String> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path.as_ref())
        .and_then(|mut file| file.write_all(contents.as_bytes()))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_first_ledger_and_refuses_to_overwrite() {
        let root = std::env::temp_dir().join(format!("beandesk-init-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        init_ledger_tree(&root).unwrap();
        assert!(root.join("main.bean").is_file());
        assert!(root.join("config/accounts.bean").is_file());
        assert!(root.join("documents").is_dir());
        let main = fs::read_to_string(root.join("main.bean")).unwrap();
        assert!(main.contains("option \"documents\" \"documents\""));
        assert_eq!(init_ledger_tree(&root).err().as_deref(), Some("ledger-exists"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_a_relative_directory() {
        assert_eq!(
            init_ledger_tree(Path::new("relative")).err().as_deref(),
            Some("directory")
        );
    }

    #[test]
    fn refuses_a_folder_that_already_has_files() {
        let root = std::env::temp_dir().join(format!("beandesk-not-empty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("notes.txt"), "keep").unwrap();
        assert_eq!(init_ledger_tree(&root).err().as_deref(), Some("not-empty"));
        assert!(!root.join("main.bean").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn treats_finder_metadata_as_empty() {
        let root = std::env::temp_dir().join(format!("beandesk-dsstore-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(".DS_Store"), "").unwrap();
        init_ledger_tree(&root).unwrap();
        assert!(root.join("main.bean").is_file());
        let _ = fs::remove_dir_all(&root);
    }
}
