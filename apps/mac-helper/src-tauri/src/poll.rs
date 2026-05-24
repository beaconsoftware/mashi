//! Foreground polling — frontmost app, window title, browser URL, idle time.
//!
//! Everything here shells out to `osascript` or `ioreg`. AppleScript is
//! the only stable way to read another app's window title or active tab
//! URL on modern macOS, so we accept the latency cost (~50ms per call).
//! The poll loop runs every 30s; even with three osascript calls per
//! tick the CPU cost is trivial.
//!
//! Permissions
//! -----------
//! - **Accessibility** is required to read window titles via System Events.
//!   Without it `osascript` returns an empty string; we treat that as
//!   "no title" rather than erroring.
//! - **Automation** is required per-browser to read the active tab URL.
//!   The first AppleScript send to each browser triggers a system prompt
//!   the user must approve. If denied we just skip URL capture for that
//!   browser; everything else still works.

use crate::ignore::IgnoreLists;
use once_cell::sync::Lazy;
use regex::Regex;
use std::process::Command;
use std::time::Duration;

/// Surface keys recognized by the matcher (mirrors ActivitySurface in
/// src/lib/activity/types.ts). Anything we can't classify falls back to
/// `"other"` and the backend treats it as a generic focus signal.
pub mod surface {
    pub const CURSOR: &str = "cursor";
    pub const CLAUDE_DESKTOP: &str = "claude_desktop";
    pub const FINDER: &str = "finder";
    pub const TERMINAL: &str = "terminal";
    pub const WEB: &str = "web";
    pub const OTHER: &str = "other";
}

/// Browsers we can extract the active tab URL from.
const BROWSER_APPS: &[&str] = &[
    "Safari",
    "Google Chrome",
    "Chrome",
    "Brave Browser",
    "Brave",
    "Arc",
    "Microsoft Edge",
];

/// One polled snapshot. `url` and `identifier` are best-effort.
#[derive(Debug, Clone)]
pub struct PollSnapshot {
    pub app: String,
    pub title: String,
    pub url: Option<String>,
    pub identifier: Option<String>,
    pub surface: &'static str,
}

/// What the loop returns on each tick.
#[derive(Debug, Clone)]
pub enum PollResult {
    /// We have a snapshot to send.
    Active(PollSnapshot),
    /// User has been idle longer than `idle_threshold_sec`; skip the
    /// heartbeat but log so the UI can show "Idle".
    Idle,
    /// Frontmost app or host matches the ignore lists; drop silently.
    Ignored,
    /// AppleScript permission denied / not granted yet. Surface to UI
    /// so we can prompt the user.
    PermissionDenied,
    /// Couldn't read frontmost app at all (e.g. screen locked).
    Unavailable,
}

/// Run one poll cycle. Returns quickly (~tens of ms typical, up to a few
/// hundred ms if multiple AppleScript calls run).
pub fn poll_once(ignore: &IgnoreLists, idle_threshold_sec: u64) -> PollResult {
    let idle_sec = match read_idle_seconds() {
        Some(s) => s,
        None => return PollResult::Unavailable,
    };
    if idle_sec >= idle_threshold_sec {
        return PollResult::Idle;
    }

    let app = match frontmost_app() {
        Ok(Some(a)) => a,
        Ok(None) => return PollResult::Unavailable,
        Err(PollError::PermissionDenied) => return PollResult::PermissionDenied,
        Err(_) => return PollResult::Unavailable,
    };

    if ignore.matches_app(&app) {
        return PollResult::Ignored;
    }

    let title = frontmost_window_title(&app).unwrap_or_default();
    let url = if is_browser(&app) {
        browser_active_url(&app)
    } else {
        None
    };

    if let Some(u) = url.as_deref() {
        if let Some(host) = host_of(u) {
            if ignore.matches_host(&host) {
                return PollResult::Ignored;
            }
        }
    }

    let surface = classify_surface(&app);
    let identifier = url.as_deref().and_then(extract_identifier);

    PollResult::Active(PollSnapshot {
        app,
        title,
        url,
        identifier,
        surface,
    })
}

#[derive(Debug, thiserror::Error)]
enum PollError {
    #[error("permission denied (Accessibility / Automation)")]
    PermissionDenied,
    #[error("script failed: {0}")]
    Script(String),
}

fn run_osascript(script: &str) -> Result<String, PollError> {
    let out = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| PollError::Script(e.to_string()))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        // -1743 = not authorized; -10004 / -1719 = AppleEvent send failure
        if stderr.contains("-1743") || stderr.contains("not authorized") {
            return Err(PollError::PermissionDenied);
        }
        return Err(PollError::Script(stderr.into_owned()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn frontmost_app() -> Result<Option<String>, PollError> {
    // Pulls the first frontmost process name. Empty when the Dock /
    // login window is foreground.
    let s = run_osascript(
        r#"tell application "System Events" to get name of first process whose frontmost is true"#,
    )?;
    if s.is_empty() {
        Ok(None)
    } else {
        Ok(Some(s))
    }
}

fn frontmost_window_title(app: &str) -> Option<String> {
    // Some apps (e.g. Finder when in single-window mode) return an empty
    // title — that's fine, the matcher will fall back to URL/identifier.
    let script = format!(
        r#"tell application "System Events" to tell process "{}"
            try
                get name of front window
            on error
                return ""
            end try
        end tell"#,
        escape_applescript(app)
    );
    match run_osascript(&script) {
        Ok(s) if !s.is_empty() => Some(s),
        _ => None,
    }
}

fn is_browser(app: &str) -> bool {
    BROWSER_APPS.iter().any(|b| app.eq_ignore_ascii_case(b))
}

fn browser_active_url(app: &str) -> Option<String> {
    let script = match app {
        "Safari" => r#"tell application "Safari" to get URL of current tab of front window"#
            .to_string(),
        // Chrome / Brave / Arc / Edge share Chrome's AppleScript dictionary
        a => format!(
            r#"tell application "{}" to get URL of active tab of front window"#,
            escape_applescript(a)
        ),
    };
    match run_osascript(&script) {
        Ok(s) if !s.is_empty() && s.starts_with("http") => Some(s),
        _ => None,
    }
}

fn read_idle_seconds() -> Option<u64> {
    // `ioreg -c IOHIDSystem` exposes HIDIdleTime in nanoseconds. Pulling
    // this via a single pipeline avoids shelling to `sed` separately.
    let out = Command::new("ioreg")
        .args(["-c", "IOHIDSystem"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        if let Some(idx) = line.find("HIDIdleTime") {
            // Format: `"HIDIdleTime" = 12345678900`
            let rest = &line[idx..];
            if let Some(eq) = rest.find('=') {
                let nanos: u64 = rest[eq + 1..]
                    .trim()
                    .trim_end_matches('|')
                    .trim()
                    .parse()
                    .ok()?;
                return Some(nanos / 1_000_000_000);
            }
        }
    }
    None
}

fn classify_surface(app: &str) -> &'static str {
    let lower = app.to_lowercase();
    if lower.contains("cursor") {
        surface::CURSOR
    } else if lower.contains("claude") {
        surface::CLAUDE_DESKTOP
    } else if lower == "finder" {
        surface::FINDER
    } else if lower.contains("terminal") || lower.contains("iterm") || lower.contains("ghostty")
        || lower.contains("warp") || lower.contains("alacritty")
    {
        surface::TERMINAL
    } else if is_browser(app) {
        surface::WEB
    } else {
        surface::OTHER
    }
}

fn host_of(url: &str) -> Option<String> {
    let after_scheme = url.split_once("//")?.1;
    let host = after_scheme.split(['/', '?', '#']).next()?;
    // Strip user@ and :port
    let host = host.rsplit_once('@').map(|p| p.1).unwrap_or(host);
    let host = host.split(':').next()?;
    Some(host.to_string())
}

/// Best-effort canonical-ID extraction. Anything we don't recognize gets
/// no identifier and the matcher falls back to URL match. Order matters —
/// more specific patterns first.
fn extract_identifier(url: &str) -> Option<String> {
    static PATTERNS: Lazy<Vec<(Regex, usize)>> = Lazy::new(|| {
        vec![
            // Linear issue: https://linear.app/<workspace>/issue/MAP-123/...
            (Regex::new(r"linear\.app/[^/]+/issue/([A-Z][A-Z0-9]+-\d+)").unwrap(), 1),
            // Github issue/PR: https://github.com/<org>/<repo>/(issues|pull)/123
            (Regex::new(r"github\.com/([^/]+/[^/]+/(?:issues|pull)/\d+)").unwrap(), 1),
            // Gmail: ...#all/<id> or ...#inbox/<id>
            (Regex::new(r"mail\.google\.com/[^#]*#[a-z]+/([A-Za-z0-9]+)").unwrap(), 1),
            // Slack message: ...slack.com/archives/<channel>/p<ts>
            (Regex::new(r"slack\.com/archives/([A-Z0-9]+/p\d+)").unwrap(), 1),
            // Fireflies meeting: .../view/<id>
            (Regex::new(r"fireflies\.ai/view/([A-Za-z0-9_-]+)").unwrap(), 1),
        ]
    });
    for (re, group) in PATTERNS.iter() {
        if let Some(cap) = re.captures(url) {
            if let Some(m) = cap.get(*group) {
                return Some(m.as_str().to_string());
            }
        }
    }
    None
}

fn escape_applescript(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Public re-export so the heartbeat module doesn't pull regex itself.
pub fn poll_tick_duration() -> Duration {
    Duration::from_secs(30)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_known_apps() {
        assert_eq!(classify_surface("Cursor"), surface::CURSOR);
        assert_eq!(classify_surface("Claude"), surface::CLAUDE_DESKTOP);
        assert_eq!(classify_surface("Finder"), surface::FINDER);
        assert_eq!(classify_surface("iTerm2"), surface::TERMINAL);
        assert_eq!(classify_surface("Ghostty"), surface::TERMINAL);
        assert_eq!(classify_surface("Google Chrome"), surface::WEB);
        assert_eq!(classify_surface("Arc"), surface::WEB);
        assert_eq!(classify_surface("Notion"), surface::OTHER);
    }

    #[test]
    fn linear_identifier_extracted() {
        let url = "https://linear.app/acme/issue/MAP-123/fix-the-thing";
        assert_eq!(extract_identifier(url).as_deref(), Some("MAP-123"));
    }

    #[test]
    fn github_identifier_extracted() {
        let url = "https://github.com/sidd-beacon/mashi/pull/42";
        assert_eq!(
            extract_identifier(url).as_deref(),
            Some("sidd-beacon/mashi/pull/42")
        );
    }

    #[test]
    fn gmail_identifier_extracted() {
        let url = "https://mail.google.com/mail/u/0/#all/FMfcgzGwJZcjkSwhQqwxRm";
        assert_eq!(
            extract_identifier(url).as_deref(),
            Some("FMfcgzGwJZcjkSwhQqwxRm")
        );
    }

    #[test]
    fn no_identifier_for_arbitrary_url() {
        assert!(extract_identifier("https://example.com/foo").is_none());
    }

    #[test]
    fn host_extraction_strips_port_and_path() {
        assert_eq!(host_of("https://example.com:8080/foo").as_deref(), Some("example.com"));
        assert_eq!(host_of("http://user@host.tld/path").as_deref(), Some("host.tld"));
        assert!(host_of("not-a-url").is_none());
    }

    #[test]
    fn applescript_escaping() {
        assert_eq!(escape_applescript(r#"foo"bar"#), r#"foo\"bar"#);
        assert_eq!(escape_applescript(r"foo\bar"), r"foo\\bar");
    }
}
