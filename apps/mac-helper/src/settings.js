// Settings window logic. Talks to the Rust side via Tauri's invoke() and
// listens for `status_changed` events emitted from the poll loop in
// src-tauri/src/lib.rs.
//
// We deliberately ship this as plain JS rather than TS — the helper has
// no build step and no React. Less moving parts means fewer ways for
// people building locally to hit a "missing tool" error.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);

const els = {
  url: $("url"),
  token: $("token"),
  ignoreApps: $("ignore-apps"),
  ignoreDomains: $("ignore-domains"),
  saveBtn: $("save-btn"),
  testBtn: $("test-btn"),
  clearTokenBtn: $("clear-token-btn"),
  feedback: $("save-feedback"),
  statusPill: $("status-pill"),
  statusDetail: $("status-detail"),
  permBanner: $("perm-banner"),
  permAccBtn: $("perm-acc-btn"),
  permAutoBtn: $("perm-auto-btn"),
};

function setFeedback(text, kind) {
  els.feedback.textContent = text || "";
  els.feedback.className = "feedback" + (kind ? " " + kind : "");
}

function setStatus(status) {
  if (!status) return;
  const map = {
    live: ["live", "Live"],
    paused: ["paused", "Paused"],
    no_token: ["err", "Not configured"],
    watcher_disabled: ["err", "Watcher disabled"],
    permission_needed: ["err", "Permission needed"],
  };
  const [cls, label] = map[status.kind] || ["live", status.kind || "Live"];
  els.statusPill.className = "status-pill " + cls;
  els.statusPill.textContent = label;

  let detail = "";
  if (status.kind === "paused" && status.paused_until) {
    const t = new Date(status.paused_until);
    detail = "until " + t.toLocaleString();
  } else if (status.kind === "no_token") {
    detail = "paste your token below";
  } else if (status.kind === "permission_needed") {
    detail = "grant Accessibility in System Settings";
  } else if (status.last_heartbeat_at) {
    detail = "last heartbeat " + new Date(status.last_heartbeat_at).toLocaleTimeString();
  }
  els.statusDetail.textContent = detail;
  els.permBanner.hidden = status.kind !== "permission_needed";

  if (status.last_error) {
    setFeedback(status.last_error, "err");
  }
}

function parseLines(text) {
  return (text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function load() {
  try {
    const s = await invoke("cmd_get_settings");
    els.url.value = s.mashi_url || "";
    els.ignoreApps.value = (s.ignore_apps || []).join("\n");
    els.ignoreDomains.value = (s.ignore_domains || []).join("\n");
    els.token.placeholder = s.has_token
      ? "•••••• (already saved — type to replace)"
      : "paste from /settings/activity";
  } catch (e) {
    setFeedback(String(e), "err");
  }
  try {
    const status = await invoke("cmd_get_status");
    setStatus(status);
  } catch (_) {}
}

els.saveBtn.addEventListener("click", async () => {
  els.saveBtn.disabled = true;
  setFeedback("Saving…");
  try {
    await invoke("cmd_save_settings", {
      args: {
        mashi_url: els.url.value.trim(),
        token: els.token.value.length > 0 ? els.token.value : null,
        clear_token: false,
        ignore_apps: parseLines(els.ignoreApps.value),
        ignore_domains: parseLines(els.ignoreDomains.value),
      },
    });
    await invoke("cmd_mark_first_run_seen");
    els.token.value = "";
    setFeedback("Saved.", "ok");
    await load();
  } catch (e) {
    setFeedback(String(e), "err");
  } finally {
    els.saveBtn.disabled = false;
  }
});

els.testBtn.addEventListener("click", async () => {
  els.testBtn.disabled = true;
  setFeedback("Testing…");
  try {
    const r = await invoke("cmd_test_connection");
    setFeedback(`OK — ingested ${r.ingested}, new suggestions ${r.new_suggestions}.`, "ok");
  } catch (e) {
    setFeedback(String(e), "err");
  } finally {
    els.testBtn.disabled = false;
  }
});

els.clearTokenBtn.addEventListener("click", async () => {
  if (!confirm("Remove the saved token from your Keychain?")) return;
  try {
    await invoke("cmd_save_settings", {
      args: {
        mashi_url: els.url.value.trim(),
        token: null,
        clear_token: true,
        ignore_apps: parseLines(els.ignoreApps.value),
        ignore_domains: parseLines(els.ignoreDomains.value),
      },
    });
    setFeedback("Token cleared.", "ok");
    await load();
  } catch (e) {
    setFeedback(String(e), "err");
  }
});

els.permAccBtn.addEventListener("click", async () => {
  try {
    await invoke("cmd_open_accessibility_settings");
  } catch (e) {
    setFeedback(String(e), "err");
  }
});
els.permAutoBtn.addEventListener("click", async () => {
  try {
    await invoke("cmd_open_automation_settings");
  } catch (e) {
    setFeedback(String(e), "err");
  }
});

listen("status_changed", (ev) => setStatus(ev.payload));

load();
