//! Connection lines share one file. When it passes the cap, the oldest lines
//! are dropped and the recent lines stay. The log plugin's KeepOne strategy
//! deletes the file and starts empty, so this writer replaces that file target.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use log::{LevelFilter, Log, Metadata, Record};
use tauri::{AppHandle, Manager};
use time::OffsetDateTime;
use time::macros::format_description;

const MAX_BYTES: u64 = 10 * 1024 * 1024;
const STAMP: &[time::format_description::FormatItem<'static>] =
    format_description!("[[[year]-[month]-[day]][[[hour]:[minute]:[second]]");

struct LogFile {
    path: PathBuf,
    max_bytes: u64,
    file: File,
    size: u64,
}

pub struct ConnectionLog {
    inner: Mutex<LogFile>,
}

impl ConnectionLog {
    fn open(path: PathBuf, max_bytes: u64) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        let size = file.metadata()?.len();
        Ok(Self {
            inner: Mutex::new(LogFile {
                path,
                max_bytes,
                file,
                size,
            }),
        })
    }

    fn append(&self, line: &str) -> io::Result<()> {
        let mut payload = Vec::with_capacity(line.len() + 1);
        payload.extend_from_slice(line.as_bytes());
        payload.push(b'\n');

        let mut state = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.size + payload.len() as u64 > state.max_bytes {
            let existing = fs::read(&state.path)?;
            let next = retain_newest(&existing, &payload, state.max_bytes as usize);
            let mut rewritten = OpenOptions::new()
                .write(true)
                .truncate(true)
                .create(true)
                .open(&state.path)?;
            rewritten.write_all(&next)?;
            rewritten.flush()?;
            state.file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&state.path)?;
            state.size = next.len() as u64;
            return Ok(());
        }

        state.file.write_all(&payload)?;
        state.file.flush()?;
        state.size += payload.len() as u64;
        Ok(())
    }
}

impl Log for ConnectionLog {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= LevelFilter::Info
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let line = format_line(record);
        let _ = writeln!(io::stdout(), "{line}");
        if let Err(error) = self.append(&line) {
            let _ = writeln!(io::stderr(), "connection log: {error}");
        }
    }

    fn flush(&self) {
        if let Ok(mut state) = self.inner.lock() {
            let _ = state.file.flush();
        }
    }
}

pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let mut path = app.path().app_log_dir()?;
    path.push(format!("{}.log", app.package_info().name));
    let logger = ConnectionLog::open(path, MAX_BYTES)?;
    log::set_boxed_logger(Box::new(logger))?;
    log::set_max_level(LevelFilter::Info);
    Ok(())
}

fn format_line(record: &Record) -> String {
    let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    let stamp = now.format(&STAMP).unwrap_or_default();
    format!(
        "{stamp}[{}][{}] {}",
        record.level(),
        record.target(),
        record.args()
    )
}

/// Keep the newest bytes, including `incoming`, without starting on a partial line.
fn retain_newest(existing: &[u8], incoming: &[u8], max_bytes: usize) -> Vec<u8> {
    if incoming.len() >= max_bytes {
        return incoming.to_vec();
    }

    let budget = max_bytes - incoming.len();
    let start = if existing.len() > budget {
        let mut start = existing.len() - budget;
        if start > 0 && existing[start - 1] != b'\n' {
            match existing[start..].iter().position(|byte| *byte == b'\n') {
                Some(offset) => start += offset + 1,
                None => start = existing.len(),
            }
        }
        start
    } else {
        0
    };

    let mut out = Vec::with_capacity(existing.len() - start + incoming.len());
    out.extend_from_slice(&existing[start..]);
    out.extend_from_slice(incoming);
    out
}

#[cfg(test)]
mod tests {
    use super::retain_newest;

    #[test]
    fn retain_newest_keeps_the_file_when_it_still_fits() {
        let existing = b"one\n";
        let incoming = b"two\n";
        assert_eq!(retain_newest(existing, incoming, 8), b"one\ntwo\n");
    }

    #[test]
    fn retain_newest_drops_the_oldest_whole_lines() {
        let existing = b"aaaa\nbbbb\n";
        let incoming = b"cccc\n";
        assert_eq!(retain_newest(existing, incoming, 10), b"bbbb\ncccc\n");
    }

    #[test]
    fn retain_newest_discards_a_line_cut_in_the_middle() {
        let existing = b"hello\nworld\n";
        let incoming = b"x\n";
        assert_eq!(retain_newest(existing, incoming, 10), b"world\nx\n");
    }

    #[test]
    fn retain_newest_keeps_only_the_new_line_when_older_lines_do_not_fit() {
        let existing = b"old-line\n";
        let incoming = b"new\n";
        assert_eq!(retain_newest(existing, incoming, 4), b"new\n");
    }

    #[test]
    fn retain_newest_keeps_a_record_that_is_already_larger_than_the_cap() {
        assert_eq!(retain_newest(b"old\n", b"abcdef\n", 4), b"abcdef\n");
    }
}
