/**
 * Mashi Activity Watcher — MV3 service worker.
 *
 * Responsibilities:
 *  - Listen for tab activation + URL change events.
 *  - Debounce per-tab at 5s granularity (no firing on every keystroke in the
 *    URL bar; only on a "settled" tab).
 *  - Build HeartbeatEvent payloads and POST to /api/activity/heartbeat.
 *  - Batch up to BATCH_SIZE events per request; flush on a short timer.
 *  - Respect 429 Retry-After; on 401 clear the token and notify the user.
 *  - Honor pause state (chrome.storage.local.pausedUntil) WITHOUT calling
 *    the server — saves needless requests when the user has paused locally.
 *
 * What we DO NOT do here:
 *  - We don't read page content, DOM, cookies, form fields. Only tab.url
 *    and tab.title (chrome.tabs API surface).
 *  - We don't ship the token anywhere except the configured Mashi URL.
 */

import {
  DEFAULT_IGNORE_DOMAINS,
  DEFAULT_SETTINGS,
  type ExtMessage,
  type ExtSettings,
  type HeartbeatEvent,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type StatusReply,
  type TestConnectionReply,
} from "./types.js";

const DEBOUNCE_MS = 5_000;
const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_ALARM = "mashi-flush";

interface PendingEvent {
  tabId: number;
  url: string;
  title: string;
  scheduledAt: number;
}

/**
 * Pending events keyed by tabId — we hold them until DEBOUNCE_MS has elapsed
 * since the most recent change for that tab, so URL-bar typing doesn't
 * generate dozens of fires per second.
 */
const debounceMap = new Map<number, PendingEvent>();

/**
 * Events ready to flush (debounce window expired, awaiting next POST).
 */
const eventQueue: HeartbeatEvent[] = [];

/**
 * Backoff state — if the server returns 429, we hold off until this
 * timestamp. Cleared on success.
 */
let backoffUntil = 0;

// ---------------------------------------------------------------------------
// Settings helpers — every read/write is a chrome.storage round-trip; we
// don't cache in module scope because the service worker can be terminated
// between events and the module re-loaded with a stale cache.
// ---------------------------------------------------------------------------

async function getSettings(): Promise<ExtSettings> {
  const raw = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  // First-run: persist a clientId so heartbeats from the same install
  // group together on the backend (matcher uses client_id for dedup).
  let clientId = (raw.clientId as string) || "";
  if (!clientId) {
    clientId = `ext-${crypto.randomUUID()}`;
    await chrome.storage.local.set({ clientId });
  }
  return {
    ...DEFAULT_SETTINGS,
    ...(raw as Partial<ExtSettings>),
    clientId,
  };
}

async function patchSettings(patch: Partial<ExtSettings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

// ---------------------------------------------------------------------------
// Hostname ignore-list — matches backend semantics (exact OR suffix).
// ---------------------------------------------------------------------------

function shouldIgnoreHost(hostname: string, customDomains: string[]): boolean {
  const allDomains = [...DEFAULT_IGNORE_DOMAINS, ...customDomains];
  const lc = hostname.toLowerCase();
  for (const rawPattern of allDomains) {
    const pat = rawPattern.toLowerCase().trim();
    if (!pat) continue;
    if (lc === pat) return true;
    // Suffix match (".bank" matches "wells.bank"; "therapy" matches
    // "anything.therapy" via this same loop but ONLY if surrounded by a
    // dot — guard against false positives like "therapy.com" matching
    // every host that contains "therapy").
    if (pat.startsWith(".") && lc.endsWith(pat)) return true;
    if (!pat.startsWith(".") && lc.endsWith(`.${pat}`)) return true;
  }
  return false;
}

function isHeartbeatableUrl(url: string): boolean {
  if (!url) return false;
  // Skip browser-internal URLs and local file:// (no value, and chrome:// pages
  // would spam the matcher).
  if (url.startsWith("chrome://")) return false;
  if (url.startsWith("chrome-extension://")) return false;
  if (url.startsWith("edge://")) return false;
  if (url.startsWith("about:")) return false;
  if (url.startsWith("file://")) return false;
  if (url.startsWith("view-source:")) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Tab event handlers — capture URL + title at the moment of the event,
// shove into debounceMap, schedule a settle check.
// ---------------------------------------------------------------------------

function captureTabFocus(tabId: number, url: string, title: string): void {
  debounceMap.set(tabId, {
    tabId,
    url,
    title: title ?? "",
    scheduledAt: Date.now() + DEBOUNCE_MS,
  });
  // Use an alarm rather than setTimeout — service worker may be killed
  // mid-debounce. Alarms persist.
  chrome.alarms.create(`mashi-debounce-${tabId}`, {
    when: Date.now() + DEBOUNCE_MS + 100,
  });
}

chrome.tabs.onActivated.addListener(async (info) => {
  try {
    const tab = await chrome.tabs.get(info.tabId);
    if (!tab.url || !isHeartbeatableUrl(tab.url)) return;
    captureTabFocus(info.tabId, tab.url, tab.title ?? "");
  } catch {
    // Tab may have closed before we could read it; ignore.
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only fire when the URL changes to a "complete" state to avoid
  // intermediate redirects polluting the queue.
  if (changeInfo.status !== "complete") return;
  if (!tab.active) return;
  if (!tab.url || !isHeartbeatableUrl(tab.url)) return;
  captureTabFocus(tabId, tab.url, tab.title ?? "");
});

chrome.tabs.onRemoved.addListener((tabId) => {
  debounceMap.delete(tabId);
  chrome.alarms.clear(`mashi-debounce-${tabId}`);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  // When the browser regains focus, re-emit the active tab so we capture
  // "user came back from the Mac helper / another app".
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (!tab || !tab.id || !tab.url || !isHeartbeatableUrl(tab.url)) return;
    captureTabFocus(tab.id, tab.url, tab.title ?? "");
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// Alarms — settle a debounce, run periodic flush.
// ---------------------------------------------------------------------------

chrome.alarms.create(FLUSH_ALARM, {
  periodInMinutes: FLUSH_INTERVAL_MS / 60_000,
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === FLUSH_ALARM) {
    await flushQueue();
    return;
  }
  if (alarm.name.startsWith("mashi-debounce-")) {
    const tabIdStr = alarm.name.slice("mashi-debounce-".length);
    const tabId = Number(tabIdStr);
    if (!Number.isFinite(tabId)) return;
    await settleTab(tabId);
  }
});

async function settleTab(tabId: number): Promise<void> {
  const pending = debounceMap.get(tabId);
  if (!pending) return;
  // If a newer event arrived since this alarm was scheduled, skip — the
  // newer event's own alarm will eventually fire and settle.
  if (Date.now() < pending.scheduledAt - 50) return;
  debounceMap.delete(tabId);

  const settings = await getSettings();
  if (!settings.token) {
    await patchSettings({ lastStatus: "no_token" });
    return;
  }
  if (settings.tokenInvalid) {
    await patchSettings({ lastStatus: "token_invalid" });
    return;
  }
  if (
    settings.pausedUntil &&
    new Date(settings.pausedUntil).getTime() > Date.now()
  ) {
    await patchSettings({ lastStatus: "paused" });
    return;
  }

  let hostname = "";
  try {
    hostname = new URL(pending.url).hostname;
  } catch {
    return;
  }
  if (shouldIgnoreHost(hostname, settings.customIgnoreDomains)) {
    // Silently drop ignored host.
    return;
  }

  eventQueue.push({
    surface: "web",
    signal_kind: "focus",
    url: pending.url,
    title: pending.title?.slice(0, 200),
    app: "browser",
    started_at: new Date().toISOString(),
  });

  if (eventQueue.length >= BATCH_SIZE) {
    await flushQueue();
  }
}

// ---------------------------------------------------------------------------
// HTTP — POST a batch, handle 429/401, surface status into chrome.storage.
// ---------------------------------------------------------------------------

async function flushQueue(): Promise<void> {
  if (eventQueue.length === 0) return;
  if (Date.now() < backoffUntil) return;

  const settings = await getSettings();
  if (!settings.token) return;
  if (settings.tokenInvalid) return;
  if (
    settings.pausedUntil &&
    new Date(settings.pausedUntil).getTime() > Date.now()
  )
    return;

  // Drain the queue up to BATCH_SIZE so a backlog doesn't all ship in
  // one giant request.
  const batch = eventQueue.splice(0, BATCH_SIZE);

  const body: HeartbeatRequest = {
    source: "browser_ext",
    client_id: settings.clientId,
    events: batch,
  };

  let resp: Response;
  try {
    resp = await fetch(`${settings.mashiUrl}/api/activity/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network error — re-queue the batch at the front so we retry later.
    eventQueue.unshift(...batch);
    await patchSettings({
      lastError: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (resp.status === 401) {
    await patchSettings({
      tokenInvalid: true,
      lastStatus: "token_invalid",
      lastError: "Token rejected (401). Re-paste your mashi_api_token.",
    });
    try {
      await chrome.notifications.create({
        type: "basic",
        // Reuse the 128px icon if present; falls back to the extension's
        // default icon if missing.
        iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
        title: "Mashi Activity Watcher",
        message: "Your token was rejected. Open Options to re-authenticate.",
      });
    } catch {
      // notifications permission missing — non-fatal.
    }
    return;
  }

  if (resp.status === 429) {
    const retry = Number(resp.headers.get("Retry-After") ?? "60");
    backoffUntil = Date.now() + (Number.isFinite(retry) ? retry : 60) * 1000;
    eventQueue.unshift(...batch);
    await patchSettings({
      lastError: `Rate limited; backing off for ${retry}s.`,
    });
    return;
  }

  if (!resp.ok) {
    await patchSettings({
      lastError: `Heartbeat failed: HTTP ${resp.status}`,
    });
    // Don't re-queue 4xx (likely malformed); do re-queue 5xx.
    if (resp.status >= 500) {
      eventQueue.unshift(...batch);
    }
    return;
  }

  let parsed: HeartbeatResponse;
  try {
    parsed = (await resp.json()) as HeartbeatResponse;
  } catch {
    parsed = { ingested: 0, new_suggestions: 0 };
  }

  // ingested = 0 means the watcher is disabled or paused on the server.
  // We keep heartbeating (cheap) but surface the state to the popup so
  // the user knows nothing's being stored.
  if (parsed.ingested === 0) {
    await patchSettings({
      lastStatus: "watcher_disabled",
      lastHeartbeatAt: new Date().toISOString(),
      lastError: null,
    });
  } else {
    await patchSettings({
      lastStatus: "live",
      lastHeartbeatAt: new Date().toISOString(),
      lastError: null,
    });
  }
}

// ---------------------------------------------------------------------------
// Message handlers — popup + options page talk to background via these.
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (msg: ExtMessage, _sender, sendResponse) => {
    handleMessage(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: String(err) }));
    // Returning true keeps the channel open for the async response.
    return true;
  }
);

async function handleMessage(msg: ExtMessage): Promise<unknown> {
  switch (msg.type) {
    case "get_status": {
      const settings = await getSettings();
      const reply: StatusReply = { settings };
      return reply;
    }
    case "test_connection": {
      return testConnection();
    }
    case "pause": {
      return doPause(msg.durationMinutes);
    }
    case "resume": {
      return doResume();
    }
    case "settings_changed": {
      // Token might have been re-pasted; clear the invalid flag so we'll
      // try again.
      await patchSettings({ tokenInvalid: false, lastError: null });
      return { ok: true };
    }
  }
}

async function testConnection(): Promise<TestConnectionReply> {
  const settings = await getSettings();
  if (!settings.token) {
    return { ok: false, message: "No token set." };
  }
  const probe: HeartbeatRequest = {
    source: "browser_ext",
    client_id: settings.clientId,
    events: [
      {
        surface: "web",
        signal_kind: "focus",
        url: "https://mashi-test.invalid/probe",
        title: "Mashi extension test connection",
        app: "browser",
        started_at: new Date().toISOString(),
      },
    ],
  };
  let resp: Response;
  try {
    resp = await fetch(`${settings.mashiUrl}/api/activity/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.token}`,
      },
      body: JSON.stringify(probe),
    });
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (resp.status === 401) {
    await patchSettings({ tokenInvalid: true, lastStatus: "token_invalid" });
    return { ok: false, status: 401, message: "Invalid token." };
  }
  if (!resp.ok) {
    return { ok: false, status: resp.status, message: `HTTP ${resp.status}` };
  }
  let parsed: HeartbeatResponse = { ingested: 0, new_suggestions: 0 };
  try {
    parsed = (await resp.json()) as HeartbeatResponse;
  } catch {
    // tolerate
  }
  await patchSettings({
    tokenInvalid: false,
    lastError: null,
    lastStatus: parsed.ingested === 0 ? "watcher_disabled" : "live",
    lastHeartbeatAt: new Date().toISOString(),
  });
  return {
    ok: true,
    status: resp.status,
    ingested: parsed.ingested,
    message:
      parsed.ingested === 0
        ? "Connection OK, but watcher is disabled or paused on the server."
        : "Connection OK.",
  };
}

async function doPause(
  durationMinutes: number
): Promise<{ ok: boolean; pausedUntil?: string; message?: string }> {
  const settings = await getSettings();
  if (!settings.token) return { ok: false, message: "No token set." };
  const pausedUntil = new Date(
    Date.now() + durationMinutes * 60_000
  ).toISOString();
  // Update local state immediately so we stop heartbeating without waiting
  // for the server roundtrip — server pause is authoritative across feeders,
  // but the local copy makes our own UI snappy.
  await patchSettings({ pausedUntil, lastStatus: "paused" });
  try {
    await fetch(`${settings.mashiUrl}/api/activity/pause`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.token}`,
      },
      body: JSON.stringify({ duration_minutes: durationMinutes }),
    });
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true, pausedUntil };
}

async function doResume(): Promise<{ ok: boolean; message?: string }> {
  const settings = await getSettings();
  if (!settings.token) return { ok: false, message: "No token set." };
  await patchSettings({ pausedUntil: null, lastStatus: "live" });
  try {
    await fetch(`${settings.mashiUrl}/api/activity/resume`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.token}`,
      },
    });
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// First-run install — ensure we have a clientId stamped.
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  await getSettings(); // side effect: writes clientId if missing
});
