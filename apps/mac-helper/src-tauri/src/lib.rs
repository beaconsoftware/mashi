//! Mashi Helper — Tauri entrypoint and shared state.
//!
//! Architecture
//! ============
//! - One persistent settings store on disk (Tauri's plugin-store) for
//!   the non-secret config: Mashi URL, client id, ignore lists,
//!   `paused_until`.
//! - The PAT itself lives in the macOS Keychain (see `keychain.rs`).
//!   Never the settings store.
//! - One background tokio task runs the 30s poll → heartbeat loop. It
//!   reads a snapshot of settings each tick; updates from the UI lap
//!   into the loop at the next tick (no need for explicit signaling).
//! - The tray menu is rebuilt whenever pause state changes so the
//!   labels reflect the current "Paused until X" / "Live".

pub mod heartbeat;
pub mod ignore;
pub mod keychain;
pub mod pause;
pub mod poll;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tokio::sync::RwLock;

const SETTINGS_FILE: &str = "settings.json";
const DEFAULT_MASHI_URL: &str = "https://mashi-two.vercel.app";
const IDLE_THRESHOLD_SEC: u64 = 5 * 60;

/// Non-secret persisted config. The PAT lives in the Keychain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub mashi_url: String,
    pub client_id: String,
    #[serde(default)]
    pub ignore_apps: Vec<String>,
    #[serde(default)]
    pub ignore_domains: Vec<String>,
    /// Local mirror of the server-side pause. When `Some(t)` and `t > now`
    /// the poll loop skips work. We still call /pause + /resume on the
    /// server so a killed helper doesn't leak heartbeats.
    pub paused_until: Option<DateTime<Utc>>,
    /// True if we've shown the first-run settings window.
    pub seen_first_run: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            mashi_url: DEFAULT_MASHI_URL.to_string(),
            client_id: new_client_id(),
            ignore_apps: vec![],
            ignore_domains: vec![],
            paused_until: None,
            seen_first_run: false,
        }
    }
}

fn new_client_id() -> String {
    // ts-millis + small random suffix. Stable across restarts via the
    // settings store, so server-side dedup keys on it.
    let now = Utc::now().timestamp_millis();
    let rand: u32 = rand_u32();
    format!("mac-{}-{:x}", now, rand)
}

fn rand_u32() -> u32 {
    // Cheap entropy without pulling rand crate
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    n ^ (std::process::id())
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct Status {
    /// One of: "live" | "paused" | "no_token" | "watcher_disabled" | "permission_needed".
    pub kind: String,
    pub paused_until: Option<String>,
    pub last_heartbeat_at: Option<String>,
    pub last_error: Option<String>,
}

pub struct AppState {
    pub settings: RwLock<Settings>,
    pub status: RwLock<Status>,
    pub heartbeat: heartbeat::HeartbeatClient,
    pub pause: pause::PauseClient,
}

impl AppState {
    fn new(settings: Settings) -> Self {
        Self {
            settings: RwLock::new(settings),
            status: RwLock::new(Status {
                kind: "no_token".into(),
                ..Default::default()
            }),
            heartbeat: heartbeat::HeartbeatClient::new(),
            pause: pause::PauseClient::new(),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // Hide from the dock — we live in the menubar only.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let settings = load_settings(&handle).unwrap_or_default();
            let needs_first_run = !settings.seen_first_run;
            let state = Arc::new(AppState::new(settings));
            app.manage(state.clone());

            build_tray(&handle, &state)?;
            spawn_poll_loop(handle.clone(), state.clone());

            if needs_first_run {
                if let Some(w) = app.get_webview_window("settings") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_get_settings,
            cmd_save_settings,
            cmd_get_status,
            cmd_pause_now,
            cmd_resume_now,
            cmd_test_connection,
            cmd_open_accessibility_settings,
            cmd_open_automation_settings,
            cmd_quit,
            cmd_mark_first_run_seen,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide rather than quit — we're a menubar app.
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, e| {
            if let RunEvent::ExitRequested { api, .. } = e {
                api.prevent_exit();
            }
        });
}

// --------------------------- settings I/O ---------------------------

fn load_settings(app: &AppHandle) -> Option<Settings> {
    use tauri_plugin_store::StoreExt;
    let store = app.store(SETTINGS_FILE).ok()?;
    let v = store.get("settings")?;
    serde_json::from_value::<Settings>(v).ok()
}

fn save_settings(app: &AppHandle, s: &Settings) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store(SETTINGS_FILE).map_err(|e| e.to_string())?;
    store.set(
        "settings",
        serde_json::to_value(s).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

// --------------------------- tray + menu ---------------------------

fn build_tray(app: &AppHandle, _state: &Arc<AppState>) -> tauri::Result<()> {
    // Initial label is the catch-all "Mashi" — the poll loop emits
    // status_changed on its first tick and the webview reflects the
    // current state. The tray menu item is non-interactive (disabled)
    // and only renders the initial label; live status lives in the
    // settings window pill, which subscribes to the event stream.
    let status_item = MenuItem::with_id(app, "status", "Mashi: starting…", false, None::<&str>)?;
    let pause_1h = MenuItem::with_id(app, "pause_1h", "Pause for 1 hour", true, None::<&str>)?;
    let pause_4h = MenuItem::with_id(app, "pause_4h", "Pause for 4 hours", true, None::<&str>)?;
    let pause_eod = MenuItem::with_id(app, "pause_eod", "Pause until end of day", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "Resume now", true, None::<&str>)?;
    let pause_submenu = Submenu::with_id_and_items(
        app,
        "pause_menu",
        "Pause",
        true,
        &[&pause_1h, &pause_4h, &pause_eod, &resume],
    )?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Mashi Helper", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &status_item,
            &separator,
            &pause_submenu,
            &separator,
            &settings,
            &separator,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("main")
        .menu(&menu)
        .title("M")
        .on_menu_event(move |app, ev| {
            let state = app.state::<Arc<AppState>>().inner().clone();
            let app = app.clone();
            match ev.id.as_ref() {
                "pause_1h" => spawn_pause(app, state, pause::PauseDuration::OneHour),
                "pause_4h" => spawn_pause(app, state, pause::PauseDuration::FourHours),
                "pause_eod" => spawn_pause(app, state, pause::PauseDuration::UntilEndOfDay),
                "resume" => spawn_resume(app, state),
                "settings" => open_settings_window(&app),
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { .. } = ev {
                // Default left-click already pops the menu thanks to
                // `menuOnLeftClick: true` in tauri.conf.json.
                let _ = tray;
            }
        })
        .build(app)?;
    Ok(())
}

fn open_settings_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}


// --------------------------- poll loop ---------------------------

fn spawn_poll_loop(app: AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(poll::poll_tick_duration());
        // First tick fires immediately — skip to align with 30s cadence.
        tick.tick().await;
        loop {
            tick.tick().await;
            let s = state.settings.read().await.clone();

            // Local pause check first to avoid even reading the keychain.
            if let Some(until) = s.paused_until {
                if until > Utc::now() {
                    set_status(&state, &app, "paused", Some(until)).await;
                    continue;
                }
            }

            let token = match keychain::read_token() {
                Ok(Some(t)) => t,
                Ok(None) => {
                    set_status(&state, &app, "no_token", None).await;
                    continue;
                }
                Err(e) => {
                    set_error(&state, &app, format!("keychain: {e}")).await;
                    continue;
                }
            };
            if token.is_empty() {
                set_status(&state, &app, "no_token", None).await;
                continue;
            }

            let ignore = ignore::IgnoreLists {
                apps: s.ignore_apps.clone(),
                domains: s.ignore_domains.clone(),
            };
            let result = tokio::task::spawn_blocking(move || {
                poll::poll_once(&ignore, IDLE_THRESHOLD_SEC)
            })
            .await
            .unwrap_or(poll::PollResult::Unavailable);

            match result {
                poll::PollResult::Idle | poll::PollResult::Ignored | poll::PollResult::Unavailable => {
                    set_status(&state, &app, "live", None).await;
                }
                poll::PollResult::PermissionDenied => {
                    set_status(&state, &app, "permission_needed", None).await;
                }
                poll::PollResult::Active(snap) => {
                    match state
                        .heartbeat
                        .send(&s.mashi_url, &token, &s.client_id, &snap)
                        .await
                    {
                        Ok(_) => {
                            set_last_beat(&state, &app).await;
                            set_status(&state, &app, "live", None).await;
                        }
                        Err(heartbeat::HeartbeatError::Unauthorized) => {
                            set_error(&state, &app, "Token invalid (401)".into()).await;
                        }
                        Err(e) => {
                            set_error(&state, &app, e.to_string()).await;
                        }
                    }
                }
            }
        }
    });
}

async fn set_status(
    state: &Arc<AppState>,
    app: &AppHandle,
    kind: &str,
    paused_until: Option<DateTime<Utc>>,
) {
    let mut s = state.status.write().await;
    s.kind = kind.to_string();
    s.paused_until = paused_until.map(|t| t.to_rfc3339());
    s.last_error = None;
    drop(s);
    let _ = app.emit("status_changed", &*state.status.read().await);
}

async fn set_last_beat(state: &Arc<AppState>, app: &AppHandle) {
    let mut s = state.status.write().await;
    s.last_heartbeat_at = Some(Utc::now().to_rfc3339());
    drop(s);
    let _ = app.emit("status_changed", &*state.status.read().await);
}

async fn set_error(state: &Arc<AppState>, app: &AppHandle, message: String) {
    let mut s = state.status.write().await;
    s.last_error = Some(message);
    drop(s);
    let _ = app.emit("status_changed", &*state.status.read().await);
}

// --------------------------- pause helpers ---------------------------

fn spawn_pause(app: AppHandle, state: Arc<AppState>, d: pause::PauseDuration) {
    tauri::async_runtime::spawn(async move {
        let (url, token_opt) = {
            let s = state.settings.read().await;
            (s.mashi_url.clone(), keychain::read_token().ok().flatten())
        };
        let token = match token_opt {
            Some(t) if !t.is_empty() => t,
            _ => {
                set_error(&state, &app, "Set a token in Settings first.".into()).await;
                return;
            }
        };
        match state.pause.pause(&url, &token, d).await {
            Ok(resp) => {
                let until = resp
                    .resume_at
                    .as_deref()
                    .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                    .map(|t| t.with_timezone(&Utc))
                    .unwrap_or_else(|| d.resume_at(Utc::now()));
                {
                    let mut s = state.settings.write().await;
                    s.paused_until = Some(until);
                    let _ = save_settings(&app, &s);
                }
                set_status(&state, &app, "paused", Some(until)).await;
            }
            Err(e) => set_error(&state, &app, e.to_string()).await,
        }
    });
}

fn spawn_resume(app: AppHandle, state: Arc<AppState>) {
    tauri::async_runtime::spawn(async move {
        let (url, token_opt) = {
            let s = state.settings.read().await;
            (s.mashi_url.clone(), keychain::read_token().ok().flatten())
        };
        let token = match token_opt {
            Some(t) if !t.is_empty() => t,
            _ => return,
        };
        let _ = state.pause.resume(&url, &token).await;
        {
            let mut s = state.settings.write().await;
            s.paused_until = None;
            let _ = save_settings(&app, &s);
        }
        set_status(&state, &app, "live", None).await;
    });
}

// --------------------------- commands ---------------------------

#[derive(Debug, Serialize)]
struct SettingsPayload {
    mashi_url: String,
    client_id: String,
    ignore_apps: Vec<String>,
    ignore_domains: Vec<String>,
    paused_until: Option<String>,
    has_token: bool,
}

#[tauri::command]
async fn cmd_get_settings(state: tauri::State<'_, Arc<AppState>>) -> Result<SettingsPayload, String> {
    let s = state.settings.read().await;
    let has_token = keychain::read_token()
        .map_err(|e| e.to_string())?
        .map(|t| !t.is_empty())
        .unwrap_or(false);
    Ok(SettingsPayload {
        mashi_url: s.mashi_url.clone(),
        client_id: s.client_id.clone(),
        ignore_apps: s.ignore_apps.clone(),
        ignore_domains: s.ignore_domains.clone(),
        paused_until: s.paused_until.map(|t| t.to_rfc3339()),
        has_token,
    })
}

#[derive(Debug, Deserialize)]
struct SaveSettingsArgs {
    mashi_url: String,
    token: Option<String>,
    clear_token: Option<bool>,
    ignore_apps: Vec<String>,
    ignore_domains: Vec<String>,
}

#[tauri::command]
async fn cmd_save_settings(
    state: tauri::State<'_, Arc<AppState>>,
    app: AppHandle,
    args: SaveSettingsArgs,
) -> Result<(), String> {
    let url = args.mashi_url.trim();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Mashi URL must start with http:// or https://".into());
    }

    if args.clear_token.unwrap_or(false) {
        keychain::clear_token().map_err(|e| e.to_string())?;
    } else if let Some(t) = args.token.as_deref() {
        let t = t.trim();
        if !t.is_empty() {
            keychain::store_token(t).map_err(|e| e.to_string())?;
        }
    }

    {
        let mut s = state.settings.write().await;
        s.mashi_url = url.to_string();
        s.ignore_apps = args.ignore_apps;
        s.ignore_domains = args.ignore_domains;
        save_settings(&app, &s)?;
    }
    Ok(())
}

#[tauri::command]
async fn cmd_get_status(state: tauri::State<'_, Arc<AppState>>) -> Result<Status, String> {
    Ok(state.status.read().await.clone())
}

#[tauri::command]
async fn cmd_pause_now(
    state: tauri::State<'_, Arc<AppState>>,
    app: AppHandle,
    minutes: i64,
) -> Result<(), String> {
    let d = if minutes <= 60 {
        pause::PauseDuration::OneHour
    } else if minutes <= 240 {
        pause::PauseDuration::FourHours
    } else {
        pause::PauseDuration::UntilEndOfDay
    };
    spawn_pause(app, state.inner().clone(), d);
    Ok(())
}

#[tauri::command]
async fn cmd_resume_now(
    state: tauri::State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<(), String> {
    spawn_resume(app, state.inner().clone());
    Ok(())
}

#[tauri::command]
async fn cmd_test_connection(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<heartbeat::HeartbeatResponse, String> {
    let s = state.settings.read().await.clone();
    let token = keychain::read_token()
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    state
        .heartbeat
        .test(&s.mashi_url, &token, &s.client_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_open_accessibility_settings() -> Result<(), String> {
    open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
}

#[tauri::command]
fn cmd_open_automation_settings() -> Result<(), String> {
    open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")
}

fn open_url(s: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(s)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
async fn cmd_mark_first_run_seen(
    state: tauri::State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<(), String> {
    let mut s = state.settings.write().await;
    s.seen_first_run = true;
    save_settings(&app, &s)
}
