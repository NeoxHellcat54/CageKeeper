const SAVE_KEY = "cagekeeper_v0_1_save";

const defaultState = () => ({
  version: "0.1.0",
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
let tickTimer = null;

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
  lockNote: $("lockNote"),
  acceptContract: $("acceptContract"),
  contractTitle: $("contractTitle"),
  contractBody: $("contractBody"),
  exportBtn: $("exportBtn"),
  importInput: $("importInput"),
  resetBtn: $("resetBtn"),
  toast: $("toast")
};

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
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
    stats: { ...base.stats, ...(input?.stats || {}) },
    logs: Array.isArray(input?.logs) ? input.logs : [],
    completedLocks: Array.isArray(input?.completedLocks) ? input.completedLocks : [],
    activeLock: input?.activeLock || null
  };

  if (output.activeLock) {
    output.activeLock.checkIns = output.activeLock.checkIns || {};
    output.activeLock.missedDates = Array.isArray(output.activeLock.missedDates) ? output.activeLock.missedDates : [];
  }

  return output;
}

function saveState() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function addLog(text, type = "info", at = Date.now()) {
  state.logs.unshift({ id: cryptoId(), text, type, at });
  state.logs = state.logs.slice(0, 500);
  saveState();
}

function cryptoId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  let changed = false;

  while (cursor.getTime() <= yesterdayStart) {
    const key = todayKey(cursor);
    const dayStart = startOfLocalDay(cursor);
    const lockEndDay = startOfLocalDay(new Date(lock.endAt));

    if (dayStart <= lockEndDay && !lock.checkIns[key] && !lock.missedDates.includes(key)) {
      lock.missedDates.push(key);
      state.stats.totalMissed += 1;
      state.logs.unshift({
        id: cryptoId(),
        text: `A day passed without obedience: ${formatDateOnly(cursor)}.`,
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
  addLog(`The timer for “${lock.name}” has expired. Release is now permitted.`, "expired");
}

function render() {
  detectMissedCheckins();
  maybeMarkExpired();
  renderDashboard();
  renderContract();
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
    els.lockSubtitle.textContent = "Start a self-lock when you are ready to surrender the key.";
    els.countdown.textContent = "--:--:--";
    els.countdownLabel.textContent = "No active timer";
    els.activeMeta.classList.add("hidden");
    els.checkInBtn.disabled = true;
    els.checkInBtn.textContent = "Confirm Today’s Obedience";
    els.completeLockBtn.classList.add("hidden");
    els.todayStatus.textContent = "Awaiting purpose.";
    els.todayDetails.textContent = "No active lock is demanding your attention.";
    return;
  }

  const remaining = Math.max(0, lock.endAt - now);
  const checkedToday = Boolean(lock.checkIns?.[today]);
  const isExpired = lock.status === "expired" || remaining <= 0;

  els.statusPill.textContent = isExpired ? "Timer expired" : "Lock active";
  els.lockTitle.textContent = isExpired ? "The lock has expired." : "The cage remains closed.";
  els.lockSubtitle.textContent = isExpired
    ? "Release is now permitted. Complete the lock to archive this session."
    : `“${lock.name}” is sealed until the chosen time has passed.`;
  els.countdown.textContent = isExpired ? "00:00:00" : formatCountdown(remaining);
  els.countdownLabel.textContent = isExpired ? "Release permitted" : "Time remaining";
  els.activeMeta.classList.remove("hidden");
  els.startedAt.textContent = formatDateTime(lock.startAt);
  els.releaseAt.textContent = formatDateTime(lock.endAt);
  els.durationText.textContent = formatDuration(lock.durationMs);
  els.checkinCount.textContent = String(Object.keys(lock.checkIns || {}).length);

  els.checkInBtn.disabled = isExpired || checkedToday;
  els.checkInBtn.textContent = checkedToday ? "Obedience Confirmed" : "Confirm Today’s Obedience";
  els.completeLockBtn.classList.toggle("hidden", !isExpired);

  if (isExpired) {
    els.todayStatus.textContent = "Release is permitted.";
    els.todayDetails.textContent = "The timer has reached zero. Complete the lock when you are ready to archive it.";
  } else if (checkedToday) {
    els.todayStatus.textContent = "Today’s obedience is recorded.";
    els.todayDetails.textContent = "The lock is satisfied for today. Return tomorrow if the timer still holds you.";
  } else {
    els.todayStatus.textContent = "Today’s obedience is waiting.";
    els.todayDetails.textContent = "Confirm your daily check-in before the day passes.";
  }
}

function renderContract() {
  const lock = state.activeLock;

  if (!lock) {
    els.contractTitle.textContent = "No contract is currently sealed.";
    els.contractBody.innerHTML = "<p>Start a self-lock to create a contract.</p>";
    return;
  }

  els.contractTitle.textContent = `Contract: ${escapeHtml(lock.name)}`;
  els.contractBody.innerHTML = `
    <p><strong>I accept this self-lock willingly.</strong></p>
    <p>Once sealed, the chosen duration is final until the timer expires. CageKeeper will record my progress, check-ins, and missed days.</p>
    <hr>
    <p><strong>Started:</strong> ${escapeHtml(formatDateTime(lock.startAt))}</p>
    <p><strong>Release:</strong> ${escapeHtml(formatDateTime(lock.endAt))}</p>
    <p><strong>Chosen duration:</strong> ${escapeHtml(formatDuration(lock.durationMs))}</p>
    ${lock.note ? `<p><strong>Private note:</strong> ${escapeHtml(lock.note)}</p>` : ""}
  `;
}

function renderLogs() {
  const recent = state.logs.slice(0, 5);
  els.recentLog.innerHTML = recent.length ? recent.map(renderLogItem).join("") : `<div class="empty-note">No whispers yet.</div>`;
  els.fullLog.innerHTML = state.logs.length ? state.logs.map(renderLogItem).join("") : `<div class="empty-note">History is empty.</div>`;
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
    showToast("A lock is already sealed.");
    switchScreen("dashboard");
    return;
  }

  const name = els.lockName.value.trim() || "Unnamed Lock";
  const min = Number(els.minDuration.value);
  const max = Number(els.maxDuration.value);
  const unit = els.durationUnit.value;
  const note = els.lockNote.value.trim();

  if (!els.acceptContract.checked) {
    showToast("Accept the self-lock agreement before sealing the lock.");
    return;
  }

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
    note,
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

  addLog(`“${name}” was sealed for ${formatDuration(durationMs)}.`, "start", startAt);
  saveState();
  els.startForm.reset();
  els.minDuration.value = "12";
  els.maxDuration.value = "48";
  els.durationUnit.value = "hours";
  render();
  switchScreen("dashboard");
  showToast("The lock is sealed.");
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
  addLog(`Daily obedience confirmed for ${formatDateOnly(new Date())}.`, "checkin");
  saveState();
  render();
  showToast("Today’s obedience has been recorded.");
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

  addLog(`“${completed.name}” was completed. Release was accepted.`, "completed");
  saveState();
  render();
  showToast("Lock completed and archived.");
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
      const imported = JSON.parse(String(reader.result));
      state = normalizeState(imported);
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
  const ok = window.confirm("Reset CageKeeper? This will erase the current lock, history, and stats on this device.");
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
  tickTimer = setInterval(render, 1000);
}

init();
