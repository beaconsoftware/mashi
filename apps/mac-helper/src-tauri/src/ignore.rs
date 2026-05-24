//! Local ignore lists — apps + domains the user has opted out of.
//!
//! These run BEFORE we ever leave the device. Anything matched here never
//! makes it into a heartbeat payload, never lands in the user's
//! `activity_events` table.
//!
//! The defaults mirror the browser extension's hardcoded list
//! (apps/browser-ext/src/types.ts) so behavior is consistent across
//! feeders. User-supplied entries are merged on top via the settings
//! store.

use serde::{Deserialize, Serialize};

/// Default app names we always ignore. Case-insensitive substring match
/// against the frontmost app name.
pub const DEFAULT_IGNORE_APPS: &[&str] = &[
    "1Password",
    "Bitwarden",
    "KeePassXC",
    "Tor Browser",
];

/// Default domain fragments we always ignore. Case-insensitive substring
/// match against the URL host. Matches the browser extension defaults so
/// behavior is consistent across feeders.
pub const DEFAULT_IGNORE_DOMAINS: &[&str] = &[
    "chase.com",
    "bankofamerica.com",
    "wellsfargo.com",
    "capitalone.com",
    "citi.com",
    "usbank.com",
    "1password.com",
    ".bank",
    "mybank.",
    "therapy",
    "betterhelp.com",
    "talkspace.com",
    "medical",
    "salary",
    "personal",
];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IgnoreLists {
    #[serde(default)]
    pub apps: Vec<String>,
    #[serde(default)]
    pub domains: Vec<String>,
}

impl IgnoreLists {
    /// True when `app` matches the default OR user-supplied app ignore list.
    pub fn matches_app(&self, app: &str) -> bool {
        if app.is_empty() {
            return false;
        }
        let lower = app.to_lowercase();
        DEFAULT_IGNORE_APPS
            .iter()
            .any(|a| lower.contains(&a.to_lowercase()))
            || self.apps.iter().any(|a| {
                let t = a.trim();
                !t.is_empty() && lower.contains(&t.to_lowercase())
            })
    }

    /// True when `host` matches the default OR user-supplied domain
    /// ignore list. Pass the full URL host (e.g. "mail.google.com"); we
    /// match by substring so suffixes like `.bank` work as expected.
    pub fn matches_host(&self, host: &str) -> bool {
        if host.is_empty() {
            return false;
        }
        let lower = host.to_lowercase();
        DEFAULT_IGNORE_DOMAINS
            .iter()
            .any(|d| lower.contains(&d.to_lowercase()))
            || self.domains.iter().any(|d| {
                let t = d.trim();
                !t.is_empty() && lower.contains(&t.to_lowercase())
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_apps_match_case_insensitive() {
        let lists = IgnoreLists::default();
        assert!(lists.matches_app("1Password 8"));
        assert!(lists.matches_app("1password"));
        assert!(!lists.matches_app("Cursor"));
    }

    #[test]
    fn default_domains_match_substring() {
        let lists = IgnoreLists::default();
        assert!(lists.matches_host("chase.com"));
        assert!(lists.matches_host("login.chase.com"));
        assert!(lists.matches_host("acme.bank"));
        assert!(!lists.matches_host("mail.google.com"));
    }

    #[test]
    fn user_entries_layer_on_top_of_defaults() {
        let lists = IgnoreLists {
            apps: vec!["Slack".into()],
            domains: vec!["intranet.example.com".into()],
        };
        assert!(lists.matches_app("Slack"));
        assert!(lists.matches_host("intranet.example.com"));
        // defaults still apply
        assert!(lists.matches_app("1Password"));
    }

    #[test]
    fn empty_entries_dont_match_everything() {
        let lists = IgnoreLists {
            apps: vec!["".into(), "  ".into()],
            domains: vec!["".into()],
        };
        assert!(!lists.matches_app("Cursor"));
        assert!(!lists.matches_host("mail.google.com"));
    }
}
