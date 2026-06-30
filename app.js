const SAVE_KEY = "cagekeeper_v0_1_save";

const defaultState = () => ({
  version: "0.1.1",
  activeLock: null,
  completedLocks: [],
  logs: [],
  stats: {
    completedLocks: 0,
    totalLockedMs: 0,
    totalCheckins: 0,
    totalMissed: 0
  }
});

let state = loadState();
let toastTimer = null;

const $ = (id) => document.getElementById(id);

const els = {
  statusPill: $("statusPill"),
  lockTitle: $("lockTitle"),
  lockSubtitle: $("lockSubtitle"),
  countdown: $("countdown"),
  countdownLabel: $("countdownLabel"),
  activeMeta: $("activeMeta"),
  startedAt: $("startedAt"),
  releaseAt: $("releaseAt"),
  durationText: $("durationText"),
  checkinCount: $("checkinCount"),
  checkInBtn: $("checkInBtn"),
  completeLockBtn: $("completeLockBtn"),
  todayStatus: $("todayStatus"),
  todayDetails: $("todayDetails"),
  statCompleted: $("statCompleted"),
  statTotalTime: $("statTotalTime"),
  statCheckins: $("statCheckins"),
  statMissed: $("statMissed"),
  recentLog: $("recentLog"),
  fullLog: $("fullLog"),
  startForm: $("startForm"),
  lockName: $("lockName"),
  minDuration: $("minDuration"),
  maxDuration: $("maxDuration"),
  durationUnit: $("durationUnit"),
  exportBtn: $("exportBtn"),
  importInput: $("importInput"),
  resetBtn: $("resetBtn"),
  toast: $("toast")
};

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultState();
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    console.warn("Failed to load CageKeeper save:", error);
    return defaultState();
  }
}

function normalizeState(input) {
  const base = defaultState();
  const output = {
    ...base,
    ...input,
    version: "0.1.1",
    stats: { ...base.stats, ...(input?.stats || {}) },
    logs: Array.isArray(input?.logs) ? input.logs : [],
    completedLocks: Array.isArray(input?.completedLocks) ? input.completedLocks : [],
    activeLock: input?.activeLock || null
  };

  if (output.activeLock) {
    output.activeLock.checkIns = output.activeLock.checkIns || {};
    output.activeLock.missedDates = Array.isArray(output.activeLock.missedDates) ? output.activeLock.missedDates : [];
    output.activeLock.status = output.activeLock.status || "active";
  }

  return output;
}

function saveState() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function cryptoId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addLog(text, type = "info", at = Date.now()) {
  state.logs.unshift({ id: cryptoId(), text, type, at });
  state.logs = state.logs.slice(0, 500);
  saveState();
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2800);
}

function switchScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("active-screen", screen.id === screenId);
  });

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.screen === screenId);
  });
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function detectMissedCheckins() {
  const lock = state.activeLock;
  if (!lock || lock.status !== "active") return;

  const start = new Date(lock.startAt);
  const today = new Date();
  let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const yesterdayStart = startOfLocalDay(addDays(today, -1));
  const lockEndDay = startOfLocalDay(new Date(lock.endAt));
  let changed = false;

  while (cursor.getTime() <= yesterdayStart && cursor.getTime() <= lockEndDay) {
    const key = todayKey(cursor);

    if (!lock.checkIns[key] && !lock.missedDates.includes(key)) {
      lock.missedDates.push(key);
      state.stats.totalMissed += 1;
      state.logs.unshift({
        id: cryptoId(),
        text: `Check-in missed on ${formatDateOnly(cursor)}.`,
        type: "missed",
        at: Date.now()
      });
      changed = true;
    }

    cursor = addDays(cursor, 1);
  }

  if (changed) {
    state.logs = state.logs.slice(0, 500);
    saveState();
  }
}

function maybeMarkExpired() {
  const lock = state.activeLock;
  if (!lock || lock.status !== "active") return;
  if (Date.now() < lock.endAt) return;

  lock.status = "expired";
  lock.expiredAt = Date.now();
  addLog(`Timer expired for “${lock.name}”. Release is available.`, "expired");
}

function render() {
  detectMissedCheckins();
  maybeMarkExpired();
  renderDashboard();
  renderLogs();
  renderStats();
}

function renderDashboard() {
  const lock = state.activeLock;
  const now = Date.now();
  const today = todayKey();

  if (!lock) {
    els.statusPill.textContent = "No active lock";
    els.lockTitle.textContent = "The cage is open.";
    els.lockSubtitle.textContent = "Start a self-lock when you are ready.";
    els.countdown.textContent = "--:--:--";
    els.countdownLabel.textContent = "No active timer";
    els.activeMeta.classList.add("hidden");
    els.checkInBtn.disabled = true;
    els.checkInBtn.textContent = "Check In";
    els.completeLockBtn.classList.add("hidden");
    els.todayStatus.textContent = "Nothing is sealed.";
    els.todayDetails.textContent = "No active lock is waiting for a check-in.";
    return;
  }

  const remaining = Math.max(0, lock.endAt - now);
  const checkedToday = Boolean(lock.checkIns?.[today]);
  const isExpired = lock.status === "expired" || remaining <= 0;

  els.statusPill.textContent = isExpired ? "Release available" : "Lock active";
  els.lockTitle.textContent = isExpired ? "The timer has expired." : "The cage remains closed.";
  els.lockSubtitle.textContent = isExpired
    ? "Archive the completed lock when you are ready."
    : `“${lock.name}” is sealed.`;
  els.countdown.textContent = isExpired ? "00:00:00" : formatCountdown(remaining);
  els.countdownLabel.textContent = isExpired ? "Release available" : "Time remaining";

  els.activeMeta.classList.remove("hidden");
  els.startedAt.textContent = formatDateTime(lock.startAt);
  els.releaseAt.textContent = formatDateTime(lock.endAt);
  els.durationText.textContent = formatDuration(lock.durationMs);
  els.checkinCount.textContent = String(Object.keys(lock.checkIns || {}).length);

  els.checkInBtn.disabled = isExpired || checkedToday;
  els.checkInBtn.textContent = checkedToday ? "Checked In" : "Check In";
  els.completeLockBtn.classList.toggle("hidden", !isExpired);

  if (isExpired) {
    els.todayStatus.textContent = "Release is available.";
    els.todayDetails.textContent = "The countdown reached zero. Archive the session to clear the vault.";
  } else if (checkedToday) {
    els.todayStatus.textContent = "Today is recorded.";
    els.todayDetails.textContent = "CageKeeper has logged today’s check-in.";
  } else {
    els.todayStatus.textContent = "Check-in waiting.";
    els.todayDetails.textContent = "Press Check In before the day passes.";
  }
}

function renderLogs() {
  const recent = state.logs.slice(0, 5);
  els.recentLog.innerHTML = recent.length ? recent.map(renderLogItem).join("") : `<div class="empty-note">No log entries yet.</div>`;
  els.fullLog.innerHTML = state.logs.length ? state.logs.map(renderLogItem).join("") : `<div class="empty-note">The archive is empty.</div>`;
}

function renderLogItem(log) {
  return `
    <div class="log-item">
      <div class="log-time">${escapeHtml(formatDateTime(log.at, true))}</div>
      <div class="log-text">${escapeHtml(log.text)}</div>
    </div>
  `;
}

function renderStats() {
  els.statCompleted.textContent = String(state.stats.completedLocks || 0);
  els.statTotalTime.textContent = formatDurationShort(state.stats.totalLockedMs || 0);
  els.statCheckins.textContent = String(state.stats.totalCheckins || 0);
  els.statMissed.textContent = String(state.stats.totalMissed || 0);
}

function startLock(event) {
  event.preventDefault();

  if (state.activeLock) {
    showToast("A lock is already active or waiting to be archived.");
    switchScreen("dashboard");
    return;
  }

  const name = els.lockName.value.trim() || "Unnamed Lock";
  const min = Number(els.minDuration.value);
  const max = Number(els.maxDuration.value);
  const unit = els.durationUnit.value;

  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) {
    showToast("Choose valid duration numbers.");
    return;
  }

  if (min > max) {
    showToast("Minimum duration cannot be higher than maximum duration.");
    return;
  }

  const chosenAmount = randomInt(min, max);
  const multiplier = unit === "days" ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const durationMs = chosenAmount * multiplier;
  const startAt = Date.now();
  const endAt = startAt + durationMs;

  state.activeLock = {
    id: cryptoId(),
    name,
    min,
    max,
    unit,
    chosenAmount,
    durationMs,
    startAt,
    endAt,
    status: "active",
    checkIns: {},
    missedDates: []
  };

  addLog(`“${name}” sealed for ${formatDuration(durationMs)}.`, "start", startAt);
  saveState();
  els.startForm.reset();
  els.minDuration.value = "12";
  els.maxDuration.value = "48";
  els.durationUnit.value = "hours";
  render();
  switchScreen("dashboard");
  showToast("Cage sealed.");
}

function checkInToday() {
  const lock = state.activeLock;
  if (!lock || lock.status !== "active") return;

  const key = todayKey();
  if (lock.checkIns[key]) {
    showToast("Today is already recorded.");
    return;
  }

  lock.checkIns[key] = Date.now();
  state.stats.totalCheckins += 1;
  addLog(`Check-in recorded for ${formatDateOnly(new Date())}.`, "checkin");
  saveState();
  render();
  showToast("Check-in recorded.");
}

function completeLock() {
  const lock = state.activeLock;
  if (!lock) return;

  if (Date.now() < lock.endAt) {
    showToast("The timer has not expired yet.");
    return;
  }

  const completed = {
    ...lock,
    status: "completed",
    completedAt: Date.now()
  };

  state.completedLocks.unshift(completed);
  state.completedLocks = state.completedLocks.slice(0, 200);
  state.stats.completedLocks += 1;
  state.stats.totalLockedMs += lock.durationMs;
  state.activeLock = null;

  addLog(`“${completed.name}” archived as completed.`, "completed");
  saveState();
  render();
  showToast("Lock archived.");
}

function exportSave() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = todayKey().replaceAll("-", "");
  a.href = url;
  a.download = `cagekeeper-save-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Save exported.");
}

function importSave(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      state = normalizeState(JSON.parse(String(reader.result)));
      saveState();
      render();
      switchScreen("dashboard");
      showToast("Save imported.");
    } catch (error) {
      console.warn("Import failed:", error);
      showToast("That save file could not be imported.");
    } finally {
      els.importInput.value = "";
    }
  };
  reader.readAsText(file);
}

function resetApp() {
  const ok = window.confirm("Reset CageKeeper? This erases the current lock, history, and stats on this device.");
  if (!ok) return;

  state = defaultState();
  saveState();
  render();
  switchScreen("dashboard");
  showToast("CageKeeper has been reset.");
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  if (days > 0) return `${days}d ${hh}:${mm}:${ss}`;
  return `${hh}:${mm}:${ss}`;
}

function formatDuration(ms) {
  const totalHours = Math.round(ms / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;

  if (days && hours) return `${days} day${days === 1 ? "" : "s"}, ${hours} hour${hours === 1 ? "" : "s"}`;
  if (days) return `${days} day${days === 1 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function formatDurationShort(ms) {
  const totalHours = Math.round(ms / 3600000);
  if (totalHours < 24) return `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

function formatDateTime(value, compact = false) {
  const date = new Date(value);
  const options = compact
    ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  return date.toLocaleString(undefined, options);
}

function formatDateOnly(date) {
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindEvents() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchScreen(btn.dataset.screen));
  });

  els.startForm.addEventListener("submit", startLock);
  els.checkInBtn.addEventListener("click", checkInToday);
  els.completeLockBtn.addEventListener("click", completeLock);
  els.exportBtn.addEventListener("click", exportSave);
  els.importInput.addEventListener("change", importSave);
  els.resetBtn.addEventListener("click", resetApp);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}

function init() {
  bindEvents();
  registerServiceWorker();
  render();
  setInterval(render, 1000);
}

init();
