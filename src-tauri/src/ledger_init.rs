use std::fs;
use std::io::Write;
use std::path::Path;

use time::OffsetDateTime;

use crate::ledger_preset::preset;

pub fn init_ledger_tree(directory: &Path, locale: &str) -> Result<(), String> {
    if !directory.is_absolute() || !directory.is_dir() {
        return Err("directory".to_string());
    }
    if directory.join("main.bean").exists() {
        return Err("ledger-exists".to_string());
    }
    if !effectively_empty(directory)? {
        return Err("not-empty".to_string());
    }
    let pack = preset(locale)?;

    let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    let year = now.year();
    let month = u8::from(now.month());
    let year_dir = directory.join("data").join(year.to_string());
    fs::create_dir_all(directory.join("config")).map_err(|error| error.to_string())?;
    fs::create_dir_all(&year_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(directory.join("documents")).map_err(|error| error.to_string())?;
    fs::create_dir_all(directory.join("policies/base")).map_err(|error| error.to_string())?;

    let month_file = format!("{year}-{month:02}.bean");
    let main = format!(
        "option \"title\" \"Ledger\"\n\
         option \"operating_currency\" \"{}\"\n\
         option \"documents\" \"documents\"\n\
         include \"config/commodities.bean\"\n\
         include \"config/accounts.bean\"\n\
         include \"data/{year}/{year}.bean\"\n",
        pack.operating_currency
    );
    let year_index = format!("include \"{month_file}\"\n");

    write_new(directory.join("main.bean"), &main)?;
    write_new(directory.join("config/commodities.bean"), pack.commodities)?;
    write_new(directory.join("config/accounts.bean"), pack.accounts)?;
    write_new(year_dir.join(format!("{year}.bean")), &year_index)?;
    write_new(year_dir.join(&month_file), "")?;
    write_new(directory.join(".gitignore"), BACKUP_GITIGNORE)?;
    write_new(directory.join("policies/README.md"), pack.policies_readme)?;
    write_new(
        directory.join("policies/base/chart-of-accounts.md"),
        pack.chart_of_accounts,
    )?;
    write_new(
        directory.join("policies/base/document-filing.md"),
        pack.document_filing,
    )?;
    write_new(
        directory.join("policies/base/bookkeeping-guide.md"),
        pack.bookkeeping_guide,
    )?;
    if let Some(rules) = pack.rules {
        write_new(directory.join("policies/base/rules.toml"), rules)?;
    }
    write_new(directory.join(APP_MARKER), "beandesk\n")?;
    Ok(())
}

pub const APP_MARKER: &str = ".beandesk";

pub fn app_created_ledger(directory: &Path) -> bool {
    directory.join(APP_MARKER).is_file()
}

pub const BACKUP_GITIGNORE: &str = "\
.backup_key
.env
backups/
.DS_Store
";

pub fn ensure_backup_gitignore(directory: &Path) -> Result<(), String> {
    let path = directory.join(".gitignore");
    if path.is_file() {
        let current = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        if current.contains(".backup_key") && current.contains("backups/") {
            return Ok(());
        }
        let mut next = current;
        if !next.ends_with('\n') && !next.is_empty() {
            next.push('\n');
        }
        next.push_str(BACKUP_GITIGNORE);
        fs::write(&path, next).map_err(|error| error.to_string())?;
        return Ok(());
    }
    write_new(path, BACKUP_GITIGNORE)
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

    fn scratch(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "beandesk-init-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn writes_a_zh_cn_ledger_and_refuses_to_overwrite() {
        let root = scratch("zh");
        init_ledger_tree(&root, "").unwrap();
        assert!(root.join("main.bean").is_file());
        assert!(root.join("config/accounts.bean").is_file());
        assert!(root.join("config/commodities.bean").is_file());
        assert!(root.join("documents").is_dir());
        assert!(root.join("policies/base/rules.toml").is_file());
        let policies = fs::read_to_string(root.join("policies/README.md")).unwrap();
        assert!(policies.contains("Bookkeeping policies"));
        assert!(policies.contains("base/"));
        let main = fs::read_to_string(root.join("main.bean")).unwrap();
        assert!(main.contains("option \"documents\" \"documents\""));
        assert!(main.contains("option \"operating_currency\" \"CNY\""));
        let ignore = fs::read_to_string(root.join(".gitignore")).unwrap();
        assert!(ignore.contains(".backup_key"));
        let commodities = fs::read_to_string(root.join("config/commodities.bean")).unwrap();
        assert!(commodities.contains("commodity CNY"));
        assert!(commodities.contains("commodity USD"));
        let accounts = fs::read_to_string(root.join("config/accounts.bean")).unwrap();
        assert!(accounts.contains("Assets:Bank-银行存款:Main-基本户"));
        assert!(accounts.contains("Equity:Capital-实收资本:PaidIn-股东出资"));
        assert!(accounts.contains("cash: TRUE"));
        assert!(!accounts.contains("软件定制开发"));
        assert!(!accounts.contains("云计算与算力"));
        assert!(app_created_ledger(&root));
        assert_eq!(
            init_ledger_tree(&root, "").err().as_deref(),
            Some("ledger-exists")
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn writes_an_english_usd_ledger() {
        let root = scratch("en");
        init_ledger_tree(&root, "en").unwrap();
        let main = fs::read_to_string(root.join("main.bean")).unwrap();
        assert!(main.contains("option \"operating_currency\" \"USD\""));
        let accounts = fs::read_to_string(root.join("config/accounts.bean")).unwrap();
        assert!(accounts.contains("Assets:Bank:Checking"));
        assert!(accounts.contains("Equity:Capital:PaidIn"));
        assert!(!accounts.contains("银行存款"));
        assert!(!root.join("policies/base/rules.toml").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn unknown_locale_writes_nothing() {
        let root = scratch("ar");
        assert_eq!(
            init_ledger_tree(&root, "ar").err().as_deref(),
            Some("unsupported-locale")
        );
        assert!(!root.join("main.bean").exists());
        assert!(!root.join(".beandesk").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_a_relative_directory() {
        assert_eq!(
            init_ledger_tree(Path::new("relative"), "").err().as_deref(),
            Some("directory")
        );
    }

    #[test]
    fn refuses_a_folder_that_already_has_files() {
        let root = scratch("not-empty");
        fs::write(root.join("notes.txt"), "keep").unwrap();
        assert_eq!(
            init_ledger_tree(&root, "").err().as_deref(),
            Some("not-empty")
        );
        assert!(!root.join("main.bean").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn treats_finder_metadata_as_empty() {
        let root = scratch("dsstore");
        fs::write(root.join(".DS_Store"), "").unwrap();
        init_ledger_tree(&root, "").unwrap();
        assert!(root.join("main.bean").is_file());
        let _ = fs::remove_dir_all(&root);
    }
}
