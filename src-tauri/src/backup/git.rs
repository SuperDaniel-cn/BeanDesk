use std::path::Path;

use git2::{Index, IndexAddOption, Oid, Repository, Signature};

use crate::ledger_init::ensure_backup_gitignore;

use super::settings::{SNAPSHOT_PATHS, require_ledger};

pub fn snapshot(directory: &Path) -> Result<Option<String>, String> {
    require_ledger(directory)?;
    ensure_backup_gitignore(directory)?;
    let repo = ensure_repo(directory)?;
    let mut index = repo.index().map_err(|_| "git".to_string())?;
    stage_snapshot(&mut index, directory)?;
    index.write().map_err(|_| "git".to_string())?;
    let tree_id = index.write_tree().map_err(|_| "git".to_string())?;
    if head_tree_is(&repo, tree_id)? {
        return Ok(None);
    }
    let tree = repo.find_tree(tree_id).map_err(|_| "git".to_string())?;
    let sig = signature(&repo)?;
    let parent = head_commit(&repo)?;
    let parents: Vec<_> = parent.iter().collect();
    let message = format!("BeanDesk snapshot {}", now_stamp());
    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|_| "git".to_string())?;
    Ok(Some(short_hash(oid)))
}

fn stage_snapshot(index: &mut Index, directory: &Path) -> Result<(), String> {
    for rel in SNAPSHOT_PATHS {
        let abs = directory.join(rel);
        if abs.is_file() {
            index
                .add_path(Path::new(rel))
                .map_err(|_| "git".to_string())?;
        } else if abs.is_dir() {
            index
                .add_all([rel], IndexAddOption::DEFAULT, None)
                .map_err(|_| "git".to_string())?;
        }
    }
    Ok(())
}

fn ensure_repo(directory: &Path) -> Result<Repository, String> {
    if directory.join(".git").exists() {
        return Repository::open(directory).map_err(|_| "git".to_string());
    }
    let repo = Repository::init(directory).map_err(|_| "git".to_string())?;
    if let Ok(mut config) = repo.config() {
        let _ = config.set_str("user.name", "BeanDesk");
        let _ = config.set_str("user.email", "backup@beandesk.local");
    }
    Ok(repo)
}

fn signature(repo: &Repository) -> Result<Signature<'static>, String> {
    let (name, email) = repo
        .signature()
        .ok()
        .map(|sig| {
            (
                sig.name().unwrap_or("BeanDesk").to_string(),
                sig.email()
                    .unwrap_or("backup@beandesk.local")
                    .to_string(),
            )
        })
        .unwrap_or_else(|| ("BeanDesk".into(), "backup@beandesk.local".into()));
    Signature::now(&name, &email).map_err(|_| "git".to_string())
}

fn head_commit(repo: &Repository) -> Result<Option<git2::Commit<'_>>, String> {
    match repo.head() {
        Ok(head) => Ok(Some(head.peel_to_commit().map_err(|_| "git".to_string())?)),
        Err(err)
            if err.code() == git2::ErrorCode::UnbornBranch
                || err.code() == git2::ErrorCode::NotFound =>
        {
            Ok(None)
        }
        Err(_) => Err("git".to_string()),
    }
}

fn head_tree_is(repo: &Repository, tree_id: Oid) -> Result<bool, String> {
    Ok(head_commit(repo)?.is_some_and(|commit| commit.tree_id() == tree_id))
}

fn short_hash(oid: Oid) -> String {
    oid.to_string().chars().take(7).collect()
}

fn now_stamp() -> String {
    let now = time::OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02} UTC",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("beandesk-git-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("config")).unwrap();
        fs::create_dir_all(root.join("data")).unwrap();
        fs::create_dir_all(root.join("documents")).unwrap();
        fs::write(root.join("main.bean"), "option \"title\" \"Ledger\"\n").unwrap();
        fs::write(root.join("config/accounts.bean"), "").unwrap();
        root
    }

    #[test]
    fn snapshot_commits_then_skips_when_unchanged() {
        let root = scratch("snap");
        let first = snapshot(&root).unwrap();
        assert!(first.is_some());
        assert!(root.join(".git").exists());
        assert!(root.join(".gitignore").is_file());
        assert_eq!(snapshot(&root).unwrap(), None);
        fs::write(root.join("documents/note.txt"), "keep").unwrap();
        assert!(snapshot(&root).unwrap().is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn snapshot_needs_an_absolute_ledger() {
        assert_eq!(
            snapshot(Path::new("relative")).err().as_deref(),
            Some("directory")
        );
    }
}
