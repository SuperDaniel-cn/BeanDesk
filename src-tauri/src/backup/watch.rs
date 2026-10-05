use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::settings::{BackupSettings, collect_mtimes};

const POLL: Duration = Duration::from_millis(50);
const SCAN: Duration = Duration::from_millis(1500);

pub struct Watch {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
    directory: Option<PathBuf>,
    settings: Arc<Mutex<BackupSettings>>,
}

impl Default for Watch {
    fn default() -> Self {
        Self {
            stop: Arc::new(AtomicBool::new(false)),
            handle: None,
            directory: None,
            settings: Arc::new(Mutex::new(BackupSettings::default())),
        }
    }
}

impl Watch {
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        self.stop = Arc::new(AtomicBool::new(false));
        self.directory = None;
    }

    pub fn start(
        &mut self,
        directory: PathBuf,
        settings: BackupSettings,
        on_quiet: Arc<dyn Fn(PathBuf, BackupSettings) + Send + Sync>,
    ) {
        if let Ok(mut slot) = self.settings.lock() {
            *slot = settings.clone();
        }
        if self.running() && self.directory.as_ref() == Some(&directory) {
            return;
        }
        self.stop();
        if let Ok(mut slot) = self.settings.lock() {
            *slot = settings;
        }
        self.directory = Some(directory.clone());
        let stop = Arc::clone(&self.stop);
        let settings = Arc::clone(&self.settings);
        self.handle = Some(thread::spawn(move || {
            let mut last = collect_mtimes(&directory).unwrap_or_default();
            let mut dirty_at: Option<Instant> = None;
            while sleep_while_running(&stop, SCAN) {
                let next = match collect_mtimes(&directory) {
                    Ok(times) => times,
                    Err(_) => continue,
                };
                if next != last {
                    last = next;
                    dirty_at = Some(Instant::now());
                }
                let debounce = settings
                    .lock()
                    .map(|current| Duration::from_secs(u64::from(current.debounce_secs.max(1))))
                    .unwrap_or(Duration::from_secs(5));
                if dirty_at.is_some_and(|started| started.elapsed() >= debounce) {
                    dirty_at = None;
                    let snapshot = settings
                        .lock()
                        .map(|current| current.clone())
                        .unwrap_or_default();
                    on_quiet(directory.clone(), snapshot);
                }
            }
        }));
    }

    pub fn running(&self) -> bool {
        self.handle
            .as_ref()
            .is_some_and(|handle| !handle.is_finished())
    }
}

fn sleep_while_running(stop: &AtomicBool, total: Duration) -> bool {
    let deadline = Instant::now() + total;
    while Instant::now() < deadline {
        if stop.load(Ordering::SeqCst) {
            return false;
        }
        thread::sleep(POLL);
    }
    !stop.load(Ordering::SeqCst)
}

pub type SharedWatch = Arc<Mutex<Watch>>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sleep_returns_when_asked_to_stop() {
        let stop = AtomicBool::new(true);
        let started = Instant::now();
        assert!(!sleep_while_running(&stop, Duration::from_secs(2)));
        assert!(started.elapsed() < Duration::from_millis(200));
    }
}
