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
        on_first: Arc<dyn Fn(PathBuf, BackupSettings) + Send + Sync>,
        on_quiet: Arc<dyn Fn(PathBuf, BackupSettings) + Send + Sync>,
    ) {
        if let Ok(mut slot) = self.settings.lock() {
            *slot = settings;
        }
        if self.running() && self.directory.as_ref() == Some(&directory) {
            return;
        }
        self.stop();
        self.directory = Some(directory.clone());
        let stop = Arc::clone(&self.stop);
        let settings = Arc::clone(&self.settings);
        self.handle = Some(thread::spawn(move || {
            let mut last = collect_mtimes(&directory).unwrap_or_default();
            let snapshot = settings
                .lock()
                .map(|current| current.clone())
                .unwrap_or_default();
            on_first(directory.clone(), snapshot);
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
    use std::sync::atomic::AtomicUsize;

    fn scratch(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("beandesk-watch-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("data")).unwrap();
        std::fs::write(root.join("main.bean"), "option \"title\" \"Ledger\"\n").unwrap();
        root
    }

    fn wait_until(timeout: Duration, check: impl Fn() -> bool) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if check() {
                return true;
            }
            if Instant::now() >= deadline {
                return check();
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn counting() -> (
        Arc<AtomicUsize>,
        Arc<dyn Fn(PathBuf, BackupSettings) + Send + Sync>,
    ) {
        let hits = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&hits);
        (
            hits,
            Arc::new(move |_, _| {
                seen.fetch_add(1, Ordering::SeqCst);
            }),
        )
    }

    fn quick_settings() -> BackupSettings {
        BackupSettings {
            debounce_secs: 1,
            ..BackupSettings::default()
        }
    }

    #[test]
    fn sleep_returns_when_asked_to_stop() {
        let stop = AtomicBool::new(true);
        let started = Instant::now();
        assert!(!sleep_while_running(&stop, Duration::from_secs(2)));
        assert!(started.elapsed() < Duration::from_millis(200));
    }

    #[test]
    fn first_start_fires_git_callback_before_scan() {
        let root = scratch("first");
        let mut watch = Watch::default();
        let (first, on_first) = counting();
        let (quiet, on_quiet) = counting();
        let started = Instant::now();
        watch.start(root.clone(), quick_settings(), on_first, on_quiet);
        assert!(wait_until(Duration::from_millis(400), || {
            first.load(Ordering::SeqCst) == 1
        }));
        assert!(started.elapsed() < SCAN);
        thread::sleep(Duration::from_millis(80));
        assert_eq!(quiet.load(Ordering::SeqCst), 0);
        watch.stop();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn second_start_on_same_dir_does_not_fire_first_again() {
        let root = scratch("again");
        let mut watch = Watch::default();
        let (first, on_first) = counting();
        let (_quiet, on_quiet) = counting();
        watch.start(
            root.clone(),
            quick_settings(),
            Arc::clone(&on_first),
            on_quiet,
        );
        assert!(wait_until(Duration::from_millis(400), || {
            first.load(Ordering::SeqCst) == 1
        }));
        let (_quiet2, on_quiet2) = counting();
        watch.start(root.clone(), quick_settings(), on_first, on_quiet2);
        thread::sleep(Duration::from_millis(80));
        assert_eq!(first.load(Ordering::SeqCst), 1);
        watch.stop();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn later_file_change_still_debounce_fires() {
        let root = scratch("later");
        let mut watch = Watch::default();
        let (first, on_first) = counting();
        let (quiet, on_quiet) = counting();
        watch.start(root.clone(), quick_settings(), on_first, on_quiet);
        assert!(wait_until(Duration::from_millis(400), || {
            first.load(Ordering::SeqCst) == 1
        }));
        std::fs::write(root.join("data/2026-10.bean"), "2026-10-01 * \"rent\"\n").unwrap();
        assert!(wait_until(SCAN + SCAN + Duration::from_secs(2), || {
            quiet.load(Ordering::SeqCst) == 1
        }));
        assert_eq!(first.load(Ordering::SeqCst), 1);
        watch.stop();
        let _ = std::fs::remove_dir_all(&root);
    }
}
