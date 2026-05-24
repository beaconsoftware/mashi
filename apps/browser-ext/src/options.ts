/**
 * Options page — read settings into the form, write on Save, and offer a
 * "Test connection" button that hits the background service worker.
 *
 * We touch chrome.storage.local directly for reads/writes (no need to
 * message the background) — the background subscribes to storage changes
 * implicitly by re-reading settings on every event.
 */

import {
  DEFAULT_SETTINGS,
  type ExtSettings,
  type TestConnectionReply,
} from "./types.js";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

async function load(): Promise<ExtSettings> {
  const raw = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...(raw as Partial<ExtSettings>) };
}

function setStatus(
  kind: "ok" | "err" | "info",
  msg: string,
  durationMs = 4000
): void {
  const el = $<HTMLDivElement>("status");
  el.textContent = msg;
  el.className = `status ${kind}`;
  el.hidden = false;
  if (durationMs > 0) {
    setTimeout(() => {
      el.hidden = true;
    }, durationMs);
  }
}

function renderTokenHint(token: string): void {
  const hint = $<HTMLSpanElement>("tokenHint");
  // If a token is already saved, show the last 4 chars so the user can
  // confirm at a glance without typing it in plaintext.
  if (token) {
    const tail = token.slice(-4);
    hint.innerHTML = `Currently saved: <span class="token-display">…${tail}</span>. Paste to replace, or leave blank to keep.`;
  } else {
    hint.innerHTML = `Generate at <a id="tokenLink" href="#" target="_blank">/settings/activity</a> with scope <code>activity:write</code>. Stored only in <code>chrome.storage.local</code>; never sent anywhere except the Mashi URL above.`;
  }
}

function updateTokenLink(url: string): void {
  const link = document.getElementById("tokenLink") as HTMLAnchorElement | null;
  if (!link) return;
  try {
    link.href = `${new URL(url).origin}/settings/activity`;
  } catch {
    link.href = "#";
  }
}

async function init(): Promise<void> {
  const settings = await load();

  const urlInput = $<HTMLInputElement>("mashiUrl");
  const tokenInput = $<HTMLInputElement>("token");
  const ignoreInput = $<HTMLTextAreaElement>("customIgnore");

  urlInput.value = settings.mashiUrl || DEFAULT_SETTINGS.mashiUrl;
  tokenInput.value = ""; // Never pre-fill the token field; show last 4 in hint.
  ignoreInput.value = (settings.customIgnoreDomains ?? []).join("\n");
  renderTokenHint(settings.token);
  updateTokenLink(urlInput.value);

  urlInput.addEventListener("input", () => updateTokenLink(urlInput.value));

  $<HTMLButtonElement>("saveBtn").addEventListener("click", async () => {
    const url = urlInput.value.trim().replace(/\/+$/, "");
    if (!url) {
      setStatus("err", "Mashi URL is required.");
      return;
    }
    try {
      new URL(url);
    } catch {
      setStatus("err", "Mashi URL must be a valid URL.");
      return;
    }
    const newToken = tokenInput.value.trim();
    // Empty = keep existing.
    const finalToken = newToken || settings.token;
    const customIgnoreDomains = ignoreInput.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    await chrome.storage.local.set({
      mashiUrl: url,
      token: finalToken,
      customIgnoreDomains,
      // Clear the invalid flag on save — the new token deserves a fresh try.
      tokenInvalid: false,
      lastError: null,
    });
    // Nudge the background so any cached state recomputes on next event.
    try {
      await chrome.runtime.sendMessage({ type: "settings_changed" });
    } catch {
      // background may be asleep — that's fine, next event will reload.
    }
    setStatus("ok", "Saved.");
    renderTokenHint(finalToken);
    tokenInput.value = "";
  });

  $<HTMLButtonElement>("testBtn").addEventListener("click", async () => {
    setStatus("info", "Testing…", 0);
    // If the user has typed a new token but not saved, test against IT —
    // they probably want the most immediate signal.
    const pendingToken = tokenInput.value.trim();
    if (pendingToken) {
      await chrome.storage.local.set({
        token: pendingToken,
        tokenInvalid: false,
      });
    }
    const url = urlInput.value.trim().replace(/\/+$/, "");
    if (url) {
      await chrome.storage.local.set({ mashiUrl: url });
    }
    let reply: TestConnectionReply;
    try {
      reply = (await chrome.runtime.sendMessage({
        type: "test_connection",
      })) as TestConnectionReply;
    } catch (err) {
      setStatus("err", `Error: ${err instanceof Error ? err.message : err}`);
      return;
    }
    if (!reply) {
      setStatus("err", "No response from background.");
      return;
    }
    if (reply.ok) {
      setStatus("ok", reply.message ?? "Connection OK.");
    } else {
      setStatus("err", reply.message ?? `Failed${reply.status ? ` (${reply.status})` : ""}.`);
    }
  });
}

void init();
