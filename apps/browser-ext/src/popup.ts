/**
 * Popup — surfaces live/paused/no-token/invalid status, lets the user
 * pause for a window or resume. All state lives in the background; we
 * just message it.
 */

import type { ExtSettings, StatusReply } from "./types.js";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function applyStatus(settings: ExtSettings): void {
  const dot = $<HTMLSpanElement>("statusDot");
  const label = $<HTMLSpanElement>("statusLabel");
  const info = $<HTMLDivElement>("info");
  const err = $<HTMLDivElement>("errBanner");
  const pausePanel = $<HTMLDivElement>("pausePanel");
  const livePanel = $<HTMLDivElement>("livePanel");
  const pauseEnd = $<HTMLSpanElement>("pauseEnd");

  err.textContent = settings.lastError ?? "";

  // Compute "real" status from settings — the background may have stale
  // lastStatus if it was killed before updating, so we re-derive locally.
  let status: ExtSettings["lastStatus"] = settings.lastStatus;
  if (!settings.token) status = "no_token";
  else if (settings.tokenInvalid) status = "token_invalid";
  else if (
    settings.pausedUntil &&
    new Date(settings.pausedUntil).getTime() > Date.now()
  )
    status = "paused";

  dot.className = "dot";
  switch (status) {
    case "live":
      dot.classList.add("live");
      label.textContent = "Live";
      info.textContent = `Last heartbeat ${fmtRelative(settings.lastHeartbeatAt)}.`;
      pausePanel.hidden = true;
      livePanel.hidden = false;
      break;
    case "watcher_disabled":
      dot.classList.add("paused");
      label.textContent = "Server off";
      info.textContent =
        "Connected, but the Activity Watcher is disabled on your Mashi account. Enable it in Settings.";
      pausePanel.hidden = true;
      livePanel.hidden = false;
      break;
    case "paused":
      dot.classList.add("paused");
      label.textContent = "Paused";
      pauseEnd.textContent = settings.pausedUntil
        ? fmtTime(settings.pausedUntil)
        : "—";
      info.textContent = "";
      pausePanel.hidden = false;
      livePanel.hidden = true;
      break;
    case "no_token":
      label.textContent = "No token";
      info.textContent =
        "Open Options and paste your mashi_api_token to start sending heartbeats.";
      pausePanel.hidden = true;
      livePanel.hidden = false;
      break;
    case "token_invalid":
      dot.classList.add("err");
      label.textContent = "Token invalid";
      info.textContent =
        "Your token was rejected. Re-generate one and paste it in Options.";
      pausePanel.hidden = true;
      livePanel.hidden = false;
      break;
  }
}

function updateLinks(mashiUrl: string): void {
  try {
    const origin = new URL(mashiUrl).origin;
    ($<HTMLAnchorElement>("tokenLink")).href = `${origin}/settings/activity`;
  } catch {
    // ignore
  }
}

async function refresh(): Promise<void> {
  const reply = (await chrome.runtime.sendMessage({
    type: "get_status",
  })) as StatusReply | undefined;
  if (!reply) return;
  applyStatus(reply.settings);
  updateLinks(reply.settings.mashiUrl);
}

async function init(): Promise<void> {
  $<HTMLAnchorElement>("optionsLink").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-pause]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const minutes = Number(btn.dataset.pause);
      if (!Number.isFinite(minutes) || minutes <= 0) return;
      btn.disabled = true;
      await chrome.runtime.sendMessage({
        type: "pause",
        durationMinutes: minutes,
      });
      await refresh();
      btn.disabled = false;
    });
  });

  $<HTMLButtonElement>("resumeBtn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "resume" });
    await refresh();
  });

  await refresh();
  // Refresh periodically so "Live, last heartbeat 1m ago" updates while open.
  setInterval(refresh, 5_000);
}

void init();
