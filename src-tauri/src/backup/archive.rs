use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use aes::Aes256;
use cbc::{Decryptor, Encryptor};
use cipher::{KeyIvInit, block_padding::Pkcs7};
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;
use tar::{Archive, Builder};

use super::settings::{
    ARCHIVE_PREFIX, ARCHIVE_SUFFIX, KEY_FILE, SNAPSHOT_PATHS, exclude_name, is_archive_name,
    reject_archive_inside_ledger, require_ledger, validate_archive_directory,
};

const MAGIC: &[u8] = b"Salted__";
const ITERATIONS: u32 = 100_000;

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
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())?;
    }
    file.write_all(password.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|error| error.to_string())
}

pub fn read_key(directory: &Path) -> Result<Vec<u8>, String> {
    let raw = fs::read_to_string(key_path(directory)).map_err(|_| "backup-key-missing".to_string())?;
    let line = raw.lines().next().unwrap_or("").trim_end_matches('\r');
    if line.is_empty() {
        return Err("backup-key-missing".to_string());
    }
    Ok(line.as_bytes().to_vec())
}

pub fn archive_filename() -> String {
    format!("{}{}{}", ARCHIVE_PREFIX, stamp(), ARCHIVE_SUFFIX)
}

pub fn write_encrypted_archive(
    directory: &Path,
    dest_dir: &Path,
    keep: u32,
) -> Result<PathBuf, String> {
    let dest_dir = validate_archive_directory(dest_dir)?;
    let dest = dest_dir.join(archive_filename());
    write_cipher(directory, &dest)?;
    prune_local(&dest_dir, keep)?;
    Ok(dest)
}

pub fn export_encrypted_archive(directory: &Path, dest: &Path) -> Result<PathBuf, String> {
    if !dest.is_absolute() {
        return Err("directory".to_string());
    }
    let dest = if dest.is_dir() {
        dest.join(archive_filename())
    } else {
        dest.to_path_buf()
    };
    write_cipher(directory, &dest)?;
    Ok(dest)
}

pub(super) fn write_cipher(directory: &Path, dest: &Path) -> Result<(), String> {
    require_ledger(directory)?;
    reject_archive_inside_ledger(directory, dest)?;
    let password = read_key(directory)?;
    if let Some(parent) = dest.parent() {
        if parent.as_os_str().is_empty() {
            return Err("directory".to_string());
        }
        if parent.exists() && !parent.is_dir() {
            return Err("directory".to_string());
        }
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let packed = pack_ledger(directory)?;
    let encrypted = encrypt_bytes(&packed, &password)?;
    if let Err(error) = write_private(dest, &encrypted) {
        let _ = fs::remove_file(dest);
        return Err(error);
    }
    Ok(())
}

pub fn restore_archive(archive: &Path, output: &Path, password: &[u8]) -> Result<(), String> {
    if !archive.is_file() {
        return Err("encrypt".to_string());
    }
    if !output.is_absolute() {
        return Err("directory".to_string());
    }
    fs::create_dir_all(output).map_err(|error| error.to_string())?;
    let cipher = fs::read(archive).map_err(|error| error.to_string())?;
    let plain = decrypt_bytes(&cipher, password)?;
    let mut archive = Archive::new(GzDecoder::new(plain.as_slice()));
    archive
        .unpack(output)
        .map_err(|_| "encrypt".to_string())
}

pub fn encrypt_bytes(plain: &[u8], password: &[u8]) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; 8];
    getrandom::fill(&mut salt).map_err(|_| "encrypt".to_string())?;
    let (key, iv) = derive(password, &salt);
    let encryptor = Encryptor::<Aes256>::new(&key.into(), &iv.into());
    let ciphertext = cipher::BlockModeEncrypt::encrypt_padded_vec::<Pkcs7>(encryptor, plain);
    let mut out = Vec::with_capacity(MAGIC.len() + salt.len() + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn decrypt_bytes(blob: &[u8], password: &[u8]) -> Result<Vec<u8>, String> {
    if blob.len() < MAGIC.len() + 8 + 16 || !blob.starts_with(MAGIC) {
        return Err("encrypt".to_string());
    }
    let salt = &blob[MAGIC.len()..MAGIC.len() + 8];
    let (key, iv) = derive(password, salt);
    let decryptor = Decryptor::<Aes256>::new(&key.into(), &iv.into());
    cipher::BlockModeDecrypt::decrypt_padded_vec::<Pkcs7>(decryptor, &blob[MAGIC.len() + 8..])
        .map_err(|_| "encrypt".to_string())
}

fn derive(password: &[u8], salt: &[u8]) -> ([u8; 32], [u8; 16]) {
    let mut key_iv = [0u8; 48];
    pbkdf2_hmac::<Sha256>(password, salt, ITERATIONS, &mut key_iv);
    let mut key = [0u8; 32];
    let mut iv = [0u8; 16];
    key.copy_from_slice(&key_iv[..32]);
    iv.copy_from_slice(&key_iv[32..]);
    (key, iv)
}

fn pack_ledger(directory: &Path) -> Result<Vec<u8>, String> {
    let encoder = GzEncoder::new(Vec::new(), Compression::default());
    let mut builder = Builder::new(encoder);
    for name in SNAPSHOT_PATHS {
        append_tree(&mut builder, directory, Path::new(name))?;
    }
    builder
        .into_inner()
        .and_then(GzEncoder::finish)
        .map_err(|error| error.to_string())
}

fn append_tree(
    builder: &mut Builder<GzEncoder<Vec<u8>>>,
    root: &Path,
    relative: &Path,
) -> Result<(), String> {
    let path = root.join(relative);
    let name = relative
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if exclude_name(name) {
        return Ok(());
    }
    if path.is_file() {
        builder
            .append_path_with_name(&path, relative)
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    if !path.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(&path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        append_tree(builder, root, &relative.join(entry.file_name()))?;
    }
    Ok(())
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())?;
    }
    file.write_all(bytes).map_err(|error| error.to_string())
}

fn prune_local(backups: &Path, keep: u32) -> Result<(), String> {
    let mut files = list_local(backups)?;
    if files.len() <= keep as usize {
        return Ok(());
    }
    files.sort();
    let excess = files.len() - keep as usize;
    for path in files.into_iter().take(excess) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

fn list_local(backups: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    let entries = match fs::read_dir(backups) {
        Ok(entries) => entries,
        Err(_) => return Ok(files),
    };
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if is_archive_name(&name) {
            files.push(entry.path());
        }
    }
    Ok(files)
}

fn stamp() -> String {
    let now = time::OffsetDateTime::now_utc();
    format!(
        "{:04}{:02}{:02}_{:02}{:02}{:02}",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    )
}

pub fn collect_mtimes(directory: &Path) -> Result<Vec<(PathBuf, u64)>, String> {
    let mut times = Vec::new();
    for name in SNAPSHOT_PATHS {
        walk_mtimes(directory.join(name), &mut times)?;
    }
    Ok(times)
}

fn walk_mtimes(path: PathBuf, times: &mut Vec<(PathBuf, u64)>) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if exclude_name(name) {
        return Ok(());
    }
    if path.is_file() {
        let modified = fs::metadata(&path)
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or(0);
        times.push((path, modified));
        return Ok(());
    }
    if !path.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(&path).map_err(|error| error.to_string())? {
        walk_mtimes(entry.map_err(|error| error.to_string())?.path(), times)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_round_trip_and_rejects_a_bad_password() {
        let secret = b"passphrase";
        let cipher = encrypt_bytes(b"ledger-bytes", secret).unwrap();
        assert!(cipher.starts_with(MAGIC));
        assert_eq!(decrypt_bytes(&cipher, secret).unwrap(), b"ledger-bytes");
        assert_eq!(
            decrypt_bytes(&cipher, b"nope").err().as_deref(),
            Some("encrypt")
        );
    }

    fn scratch(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("beandesk-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("config")).unwrap();
        fs::create_dir_all(root.join("data")).unwrap();
        fs::create_dir_all(root.join("documents")).unwrap();
        fs::write(root.join("main.bean"), "option \"title\" \"Ledger\"\n").unwrap();
        root
    }

    fn outside(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("beandesk-dest-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn failed_archive_leaves_no_partial_file() {
        let root = scratch("enc");
        let dest = outside("enc");
        fs::create_dir_all(&dest).unwrap();
        assert_eq!(
            write_encrypted_archive(&root, &dest, 30).err().as_deref(),
            Some("backup-key-missing")
        );
        assert!(fs::read_dir(&dest).unwrap().next().is_none());
        assert!(!root.join("backups").exists());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn archive_writes_to_the_chosen_folder() {
        let root = scratch("pack");
        fs::write(root.join("config/accounts.bean"), "open Assets:Cash\n").unwrap();
        fs::write(root.join(".env"), "SECRET=1\n").unwrap();
        write_key(&root, "hidden").unwrap();
        let packed = pack_ledger(&root).unwrap();
        let listing = String::from_utf8_lossy(&packed);
        assert!(!listing.contains("SECRET=1"));
        let dest_dir = outside("pack");
        fs::create_dir_all(&dest_dir).unwrap();
        let archive = write_encrypted_archive(&root, &dest_dir, 2).unwrap();
        assert!(archive.starts_with(&dest_dir));
        assert!(archive.file_name().unwrap().to_string_lossy().starts_with(ARCHIVE_PREFIX));
        assert!(!root.join("backups").exists());
        let restored = root.join("restored");
        restore_archive(&archive, &restored, b"hidden").unwrap();
        assert!(restored.join("main.bean").is_file());
        assert!(!restored.join(".env").exists());
        assert!(!restored.join(".backup_key").exists());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&dest_dir);
    }

    #[test]
    fn archive_refuses_the_ledger_tree() {
        let root = scratch("nested");
        write_key(&root, "hidden").unwrap();
        assert_eq!(
            write_encrypted_archive(&root, &root, 2).err().as_deref(),
            Some("archive-nested")
        );
        assert_eq!(
            export_encrypted_archive(&root, &root.join("documents").join("manual.tar.gz.enc"))
                .err()
                .as_deref(),
            Some("archive-nested")
        );
        assert!(!root.join("documents").join("manual.tar.gz.enc").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn export_writes_the_picked_file() {
        let root = scratch("export");
        write_key(&root, "hidden").unwrap();
        let dest = outside("export").join("manual.tar.gz.enc");
        let written = export_encrypted_archive(&root, &dest).unwrap();
        assert_eq!(written, dest);
        assert!(dest.is_file());
        let bytes = fs::read(&dest).unwrap();
        assert!(bytes.starts_with(MAGIC));
        assert!(!bytes.windows(b"option \"title\"".len()).any(|window| window == b"option \"title\""));
        assert!(!root.join("backups").exists());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(dest.parent().unwrap());
    }

    #[test]
    fn export_without_a_key_does_not_write() {
        let root = scratch("nokey");
        let dest = outside("nokey").join("manual.tar.gz.enc");
        assert_eq!(
            export_encrypted_archive(&root, &dest).err().as_deref(),
            Some("backup-key-missing")
        );
        assert!(!dest.exists());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(dest.parent().unwrap());
    }

    #[test]
    fn restore_needs_the_matching_key() {
        let root = scratch("mismatch");
        write_key(&root, "hidden").unwrap();
        let dest_dir = outside("mismatch");
        let dest = dest_dir.join("manual.tar.gz.enc");
        export_encrypted_archive(&root, &dest).unwrap();
        let wrong = root.join("wrong");
        assert_eq!(
            restore_archive(&dest, &wrong, b"nope").err().as_deref(),
            Some("encrypt")
        );
        assert!(!wrong.join("main.bean").exists());
        let right = root.join("right");
        restore_archive(&dest, &right, b"hidden").unwrap();
        assert!(right.join("main.bean").is_file());
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&dest_dir);
    }

    #[test]
    fn archive_stops_if_the_dest_folder_is_gone() {
        let root = scratch("gone");
        write_key(&root, "hidden").unwrap();
        let dest = outside("gone");
        fs::create_dir_all(&dest).unwrap();
        let archive = write_encrypted_archive(&root, &dest, 2).unwrap();
        fs::remove_file(&archive).unwrap();
        fs::remove_dir_all(&dest).unwrap();
        assert_eq!(
            write_encrypted_archive(&root, &dest, 2).err().as_deref(),
            Some("archive-dir")
        );
        assert!(!dest.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn archive_stops_if_the_key_is_gone() {
        let root = scratch("archive-keygone");
        write_key(&root, "hidden").unwrap();
        let dest = outside("archive-keygone");
        fs::create_dir_all(&dest).unwrap();
        write_encrypted_archive(&root, &dest, 2).unwrap();
        fs::remove_file(key_path(&root)).unwrap();
        assert!(!has_key(&root));
        assert_eq!(
            write_encrypted_archive(&root, &dest, 2).err().as_deref(),
            Some("backup-key-missing")
        );
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&dest);
    }

    #[test]
    fn empty_passphrase_is_not_a_key() {
        let root = scratch("emptykey");
        assert_eq!(write_key(&root, "   ").err().as_deref(), Some("backup-key-missing"));
        assert!(!key_path(&root).exists());
        let _ = fs::remove_dir_all(&root);
    }
}
