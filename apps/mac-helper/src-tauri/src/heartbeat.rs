//! HTTP client for `/api/activity/heartbeat`.
//!
//! Tiny wrapper — the route expects `{ source, client_id, events[] }`
//! and we always send exactly one event per request (we poll every 30s
//! and don't batch). Mirrors the shape in src/lib/activity/types.ts on
//! the web side — keep in lockstep with that file.

use crate::poll::PollSnapshot;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Serialize)]
struct HeartbeatEvent<'a> {
    surface: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    identifier: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    app: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<&'a str>,
    signal_kind: &'static str,
    started_at: String,
}

#[derive(Debug, Serialize)]
struct HeartbeatRequest<'a> {
    source: &'static str,
    client_id: &'a str,
    events: Vec<HeartbeatEvent<'a>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HeartbeatResponse {
    pub ingested: u32,
    pub new_suggestions: u32,
}

#[derive(Debug, thiserror::Error)]
pub enum HeartbeatError {
    #[error("not configured (missing url or token)")]
    NotConfigured,
    #[error("token invalid (401)")]
    Unauthorized,
    #[error("rate limited (429); retry after {retry_after_sec}s")]
    RateLimited { retry_after_sec: u64 },
    #[error("server returned {status}: {body}")]
    Server { status: u16, body: String },
    #[error("transport: {0}")]
    Transport(String),
}

pub struct HeartbeatClient {
    http: reqwest::Client,
}

impl HeartbeatClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .user_agent(concat!("mashi-mac-helper/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("reqwest client"),
        }
    }

    /// POST one snapshot as a heartbeat. Truncates the title to 200
    /// chars to match the server-side cap in
    /// src/app/api/activity/heartbeat/route.ts.
    pub async fn send(
        &self,
        mashi_url: &str,
        token: &str,
        client_id: &str,
        snap: &PollSnapshot,
    ) -> Result<HeartbeatResponse, HeartbeatError> {
        if mashi_url.is_empty() || token.is_empty() {
            return Err(HeartbeatError::NotConfigured);
        }

        let title = if snap.title.is_empty() {
            None
        } else {
            Some(snap.title.chars().take(200).collect::<String>())
        };

        let req = HeartbeatRequest {
            source: "mac_helper",
            client_id,
            events: vec![HeartbeatEvent {
                surface: snap.surface,
                identifier: snap.identifier.as_deref(),
                title,
                app: &snap.app,
                url: snap.url.as_deref(),
                signal_kind: "focus",
                started_at: Utc::now().to_rfc3339(),
            }],
        };

        let url = format!("{}/api/activity/heartbeat", mashi_url.trim_end_matches('/'));
        let resp = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&req)
            .send()
            .await
            .map_err(|e| HeartbeatError::Transport(e.to_string()))?;

        let status = resp.status();
        if status.is_success() {
            return resp
                .json::<HeartbeatResponse>()
                .await
                .map_err(|e| HeartbeatError::Transport(e.to_string()));
        }
        if status.as_u16() == 401 {
            return Err(HeartbeatError::Unauthorized);
        }
        if status.as_u16() == 429 {
            let retry_after_sec = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(60);
            return Err(HeartbeatError::RateLimited { retry_after_sec });
        }
        let body = resp.text().await.unwrap_or_default();
        Err(HeartbeatError::Server {
            status: status.as_u16(),
            body,
        })
    }

    /// Lightweight ping used by the "Test connection" button in
    /// settings. Sends a single synthetic event; the server responds 200
    /// with ingested counts (or 0 if the watcher is disabled — that's
    /// still an "ok" for token validation purposes).
    pub async fn test(
        &self,
        mashi_url: &str,
        token: &str,
        client_id: &str,
    ) -> Result<HeartbeatResponse, HeartbeatError> {
        let synthetic = PollSnapshot {
            app: "Mashi Helper".to_string(),
            title: "connection test".to_string(),
            url: None,
            identifier: None,
            surface: "other",
        };
        self.send(mashi_url, token, client_id, &synthetic).await
    }
}

impl Default for HeartbeatClient {
    fn default() -> Self {
        Self::new()
    }
}
