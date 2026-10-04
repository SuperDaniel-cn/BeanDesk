use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// A Fava process this window started. Stopping it signals that process group
/// and leaves any Fava the user started themselves alone.
///
/// The child also watches a pipe held here. If this desktop process disappears
/// before it can stop, the pipe closes and the child ends that same group.
#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSnapshot {
    pub running: bool,
    pub pid: Option<u32>,
    pub started_ms: Option<u64>,
}

#[derive(Default)]
pub struct Supervisor {
    child: Option<Child>,
    started_at: Option<SystemTime>,
    #[cfg(unix)]
    parent_hold: Option<std::os::fd::OwnedFd>,
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        self.stop();
    }
}

impl Supervisor {
    /// Ownership of a live child this window started. Not “something answers
    /// on the saved origin.”
    pub fn snapshot(&mut self) -> HostSnapshot {
        self.reap();
        match self.child.as_ref() {
            Some(child) => HostSnapshot {
                running: true,
                pid: Some(child.id()),
                started_ms: started_ms(self.started_at),
            },
            None => HostSnapshot::default(),
        }
    }

    /// Start `command` in `directory` when this supervisor is not already
    /// watching a live process. A second call does not start another one.
    pub fn start(&mut self, directory: &Path, command: &str) -> Result<(), String> {
        self.reap();
        if self.child.is_some() {
            return Ok(());
        }

        let command = command.trim();
        if command.is_empty() || command.len() > 4_000 || command.contains('\0') {
            return Err("empty-command".to_string());
        }
        if !directory.is_absolute() || !directory.is_dir() {
            return Err("directory".to_string());
        }

        let mut shell = grouped_shell(directory);
        #[cfg(unix)]
        let watch = install_parent_watch(&mut shell, command)?;
        #[cfg(windows)]
        shell.arg("/C").arg(command);
        let child = shell.spawn().map_err(|error| format!("spawn: {error}"))?;
        #[cfg(unix)]
        {
            drop(watch.child_read);
            self.parent_hold = Some(watch.parent_hold);
        }
        self.child = Some(child);
        self.started_at = Some(SystemTime::now());
        Ok(())
    }

    pub fn stop(&mut self) {
        #[cfg(unix)]
        {
            self.parent_hold.take();
        }
        self.started_at = None;
        let Some(mut child) = self.child.take() else {
            return;
        };
        let pid = child.id();
        signal_group(pid, false);
        let started = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if started.elapsed() < Duration::from_secs(3) => {
                    thread::sleep(Duration::from_millis(50));
                }
                Ok(None) => {
                    signal_group(pid, true);
                    let _ = child.wait();
                    return;
                }
                Err(_) => return,
            }
        }
    }

    fn reap(&mut self) {
        let finished = match self.child.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(_)) | Err(_) => true,
                Ok(None) => false,
            },
            None => false,
        };
        if finished {
            self.child = None;
            self.started_at = None;
            #[cfg(unix)]
            {
                self.parent_hold.take();
            }
        }
    }
}

fn started_ms(started_at: Option<SystemTime>) -> Option<u64> {
    started_at
        .and_then(|started| started.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as u64)
}

/// The read end stays open until after `spawn`, so the child inherits it.
#[cfg(unix)]
struct ParentWatch {
    child_read: std::os::fd::OwnedFd,
    parent_hold: std::os::fd::OwnedFd,
}

/// Run the saved command, and end its process group when the desktop process
/// closes the pipe. The command itself is still executed by a shell.
#[cfg(unix)]
fn install_parent_watch(command: &mut Command, user_command: &str) -> Result<ParentWatch, String> {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::process::CommandExt;

    const WATCH: &str = "leader=$$; ( while IFS= read -r _ <&3; do :; done; kill -TERM -$leader 2>/dev/null || true ) >/dev/null 2>&1 & exec /bin/sh -c \"$1\"";

    let mut ends = [0; 2];
    if unsafe { libc::pipe(ends.as_mut_ptr()) } != 0 {
        return Err(format!("pipe: {}", std::io::Error::last_os_error()));
    }
    let read = unsafe { OwnedFd::from_raw_fd(ends[0]) };
    let write = unsafe { OwnedFd::from_raw_fd(ends[1]) };
    let read_fd = read.as_raw_fd();
    let write_fd = write.as_raw_fd();
    unsafe {
        command.pre_exec(move || {
            if read_fd != 3 && libc::dup2(read_fd, 3) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            if read_fd != 3 {
                libc::close(read_fd);
            }
            let _ = libc::fcntl(3, libc::F_SETFD, 0);
            if write_fd != 3 {
                libc::close(write_fd);
            }
            Ok(())
        });
    }
    command
        .arg("-c")
        .arg(WATCH)
        .arg("beandesk")
        .arg(user_command);
    Ok(ParentWatch {
        child_read: read,
        parent_hold: write,
    })
}

/// Loopback http(s) origin with no path, query, user, or fragment.
pub fn accepts_local_origin(origin: &str) -> bool {
    let Some(rest) = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
    else {
        return false;
    };
    if rest.is_empty() || rest.contains(['/', '?', '#', '@']) {
        return false;
    }
    let host = if let Some(wrapped) = rest.strip_prefix('[') {
        let Some((host, after)) = wrapped.split_once(']') else {
            return false;
        };
        if !after.is_empty() && !after.starts_with(':') {
            return false;
        }
        host
    } else {
        rest.split(':').next().unwrap_or("")
    };
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn grouped_shell(directory: &Path) -> Command {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let mut cmd = Command::new("/bin/sh");
        cmd.current_dir(directory)
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .process_group(0);
        cmd
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("cmd");
        cmd.current_dir(directory)
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            // CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP. No console, and the group can still be stopped.
            .creation_flags(0x0800_0200);
        cmd
    }
}

fn signal_group(pid: u32, force: bool) {
    if pid == 0 {
        return;
    }
    #[cfg(unix)]
    unsafe {
        let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
        libc::killpg(pid as i32, signal);
    }
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command.arg("/T").arg("/PID").arg(pid.to_string());
        if force {
            command.arg("/F");
        }
        let _ = command.status();
    }
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;

    #[test]
    fn snapshot_is_empty_without_a_child() {
        let mut supervisor = Supervisor::default();
        let snap = supervisor.snapshot();
        assert!(!snap.running);
        assert!(snap.pid.is_none());
        assert!(snap.started_ms.is_none());
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Command;

    struct Reap(Option<Child>);

    impl Drop for Reap {
        fn drop(&mut self) {
            if let Some(child) = self.0.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    fn alive(pid: u32) -> bool {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }

    #[test]
    fn local_origin_is_loopback_without_a_path() {
        assert!(accepts_local_origin("http://127.0.0.1:5000"));
        assert!(accepts_local_origin("http://localhost:5000"));
        assert!(accepts_local_origin("https://[::1]:5000"));
        assert!(!accepts_local_origin("http://127.0.0.1:5000/beancount"));
        assert!(!accepts_local_origin("http://192.168.1.8:5000"));
        assert!(!accepts_local_origin("https://books.example"));
    }

    #[test]
    fn stop_kills_only_the_group_it_started() {
        let other = Reap(Some(
            Command::new("sleep")
                .arg("30")
                .stdin(Stdio::null())
                .spawn()
                .unwrap(),
        ));
        let other_pid = other.0.as_ref().unwrap().id();

        let mut supervisor = Supervisor::default();
        supervisor.start(&std::env::temp_dir(), "sleep 30").unwrap();
        let started = supervisor.child.as_ref().unwrap().id();
        assert!(supervisor.snapshot().running);
        assert_ne!(started, other_pid);

        supervisor.stop();
        assert!(!alive(started));
        assert!(alive(other_pid));
        assert!(!supervisor.snapshot().running);
    }

    #[test]
    fn a_second_start_does_not_replace_the_live_process() {
        let mut supervisor = Supervisor::default();
        let directory = std::env::temp_dir();
        supervisor.start(&directory, "sleep 30").unwrap();
        let first = supervisor.child.as_ref().unwrap().id();
        supervisor.start(&directory, "sleep 30").unwrap();
        let second = supervisor.child.as_ref().unwrap().id();
        assert_eq!(first, second);
        let snap = supervisor.snapshot();
        assert_eq!(snap.pid, Some(first));
        assert!(snap.running);
        assert!(snap.started_ms.is_some());
    }

    #[test]
    fn snapshot_clears_after_stop_and_after_the_child_exits() {
        let mut supervisor = Supervisor::default();
        supervisor.start(&std::env::temp_dir(), "sleep 30").unwrap();
        let started = supervisor.snapshot();
        assert!(started.running);
        assert!(started.pid.is_some());
        assert!(started.started_ms.is_some());

        supervisor.stop();
        let after_stop = supervisor.snapshot();
        assert!(!after_stop.running);
        assert!(after_stop.pid.is_none());
        assert!(after_stop.started_ms.is_none());

        supervisor.start(&std::env::temp_dir(), "true").unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline && supervisor.snapshot().running {
            thread::sleep(Duration::from_millis(20));
        }
        let after_exit = supervisor.snapshot();
        assert!(!after_exit.running);
        assert!(after_exit.pid.is_none());
        assert!(after_exit.started_ms.is_none());
    }

    #[test]
    fn the_started_group_ends_when_the_parent_disappears() {
        let mut supervisor = Supervisor::default();
        supervisor
            .start(&std::env::temp_dir(), "sleep 30 & sleep 30")
            .unwrap();
        let started = supervisor.child.as_ref().unwrap().id();
        std::thread::sleep(std::time::Duration::from_millis(200));
        let kids = child_pids(started);
        assert!(
            kids.iter().any(|pid| alive(*pid)),
            "expected a live child in the started group"
        );

        supervisor.parent_hold.take();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut leader_gone = false;
        while std::time::Instant::now() < deadline
            && (!leader_gone || kids.iter().any(|pid| alive(*pid)))
        {
            if let Some(child) = supervisor.child.as_mut() {
                leader_gone = leader_gone || matches!(child.try_wait(), Ok(Some(_)));
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        assert!(
            leader_gone && kids.iter().all(|pid| !alive(*pid)),
            "process group survived the parent pipe closing"
        );
    }

    fn child_pids(parent: u32) -> Vec<u32> {
        let output = Command::new("ps")
            .args(["-axo", "pid=,ppid="])
            .output()
            .unwrap();
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let mut parts = line.split_whitespace();
                let pid = parts.next()?.parse::<u32>().ok()?;
                let ppid = parts.next()?.parse::<u32>().ok()?;
                (ppid == parent).then_some(pid)
            })
            .collect()
    }
}
