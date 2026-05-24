//! Pause / resume the watcher remotely via /api/activity/pause and
//! /api/activity/resume.
//!
//! These endpoints update the server-side `activity_settings` row so
//! that even if the menubar helper is killed mid-pause, the backend
//! still drops any heartbeats that arrive (the heartbeat route gates on
//! `paused_until > now()`). The helper additionally tracks a local
//! `paused_until` in its settings store so the poll loop can skip work
//! entirely without making the network call.

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub enum PauseDuration {
    OneHour,
    FourHours,
    UntilEndOfDay,
}

impl PauseDuration {
    /// Resolve to the equivalent `resume_at` instant.
    pub fn resume_at(self, now: DateTime<Utc>) -> DateTime<Utc> {
        match self {
            Self::OneHour => now + ChronoDuration::hours(1),
            Self::FourHours => now + ChronoDuration::hours(4),
            Self::UntilEndOfDay => {
                // End of the current UTC day. We could be smarter about
                // local timezone, but the server stores TIMESTAMPTZ and
                // either side is fine for the "rest of today" pause.
                let end = now
                    .date_naive()
                    .and_hms_opt(23, 59, 59)
                    .expect("eod")
                    .and_utc();
                if end <= now {
                    now + ChronoDuration::hours(1)
                } else {
                    end
                }
            }
        }
    }

    /// Whole minutes to send to the server.
    pub fn duration_minutes(self, now: DateTime<Utc>) -> i64 {
        (self.resume_at(now) - now).num_minutes().max(1)
    }
}

#[derive(Debug, Serialize)]
struct PauseBody {
    duration_minutes: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PauseResponse {
    pub paused: bool,
    pub resume_at: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum PauseError {
    #[error("not configured (missing url or token)")]
    NotConfigured,
    #[error("token invalid (401)")]
    Unauthorized,
    #[error("server returned {status}: {body}")]
    Server { status: u16, body: String },
    #[error("transport: {0}")]
    Transport(String),
}

pub struct PauseClient {
    http: reqwest::Client,
}

impl PauseClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .user_agent(concat!("mashi-mac-helper/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("reqwest client"),
        }
    }

    pub async fn pause(
        &self,
        mashi_url: &str,
        token: &str,
        d: PauseDuration,
    ) -> Result<PauseResponse, PauseError> {
        if mashi_url.is_empty() || token.is_empty() {
            return Err(PauseError::NotConfigured);
        }
        let body = PauseBody {
            duration_minutes: d.duration_minutes(Utc::now()),
        };
        let url = format!("{}/api/activity/pause", mashi_url.trim_end_matches('/'));
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| PauseError::Transport(e.to_string()))?;
        check_status(resp).await
    }

    pub async fn resume(&self, mashi_url: &str, token: &str) -> Result<PauseResponse, PauseError> {
        if mashi_url.is_empty() || token.is_empty() {
            return Err(PauseError::NotConfigured);
        }
        let url = format!("{}/api/activity/resume", mashi_url.trim_end_matches('/'));
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| PauseError::Transport(e.to_string()))?;
        check_status(resp).await
    }
}

async fn check_status(resp: reqwest::Response) -> Result<PauseResponse, PauseError> {
    let status = resp.status();
    if status.is_success() {
        return resp
            .json::<PauseResponse>()
            .await
            .map_err(|e| PauseError::Transport(e.to_string()));
    }
    if status.as_u16() == 401 {
        return Err(PauseError::Unauthorized);
    }
    let body = resp.text().await.unwrap_or_default();
    Err(PauseError::Server {
        status: status.as_u16(),
        body,
    })
}

impl Default for PauseClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resume_at_in_future() {
        let now = Utc::now();
        assert!(PauseDuration::OneHour.resume_at(now) > now);
        assert!(PauseDuration::FourHours.resume_at(now) > now);
        // Minutes always positive
        assert!(PauseDuration::OneHour.duration_minutes(now) >= 1);
        assert!(PauseDuration::FourHours.duration_minutes(now) >= 1);
    }
}
