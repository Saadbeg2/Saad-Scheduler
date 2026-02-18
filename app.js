const STORAGE_KEY = "dailyPlanner_v1";

const BASE_STATE = {
  defaults: {
    wakeTime: "04:30",
    sleepTime: "21:00",
    nightOwlEnabledByDefault: false,
  },
  days: {},
};

let els = {};
let state = structuredClone(BASE_STATE);
let selectedDate = "";
let planMode = false; // Session-only mode, always false on reload.
let nowNextTimer = null;
let startWasAutoFilled = false;
let startProgrammaticUpdate = false;
const missingFeatureLog = new Set();

document.addEventListener("DOMContentLoaded", () => {
  init();
});

function init() {
  cacheElements();
  state = loadState();
  selectedDate = getTodayISO();
  planMode = false;

  ensureDay(selectedDate);
  bindEvents();
  render();
  startNowNextTicker();
}

function cacheElements() {
  els = {
    dayLabel: document.getElementById("dayLabel"),
    dateLabel: document.getElementById("dateLabel"),
    prevDayBtn: document.getElementById("prevDayBtn"),
    nextDayBtn: document.getElementById("nextDayBtn"),
    editDayBtn: document.getElementById("editDayBtn"),
    doneBtn: document.getElementById("doneBtn"),
    majorEventsView: document.getElementById("majorEventsView"),
    majorEventsViewList: document.getElementById("majorEventsViewList"),
    scheduleCard: document.getElementById("scheduleCard"),
    sleepWakeEditor: document.getElementById("sleepWakeEditor"),
    nowNextStrip: document.getElementById("nowNextStrip"),
    nowLine: document.getElementById("nowLine"),
    nextLine: document.getElementById("nextLine"),
    emptyState: document.getElementById("emptyState"),
    planDayBtn: document.getElementById("planDayBtn"),
    entriesList: document.getElementById("entriesList"),
    planningPanel: document.getElementById("planningPanel"),
    majorEventForm: document.getElementById("majorEventForm"),
    majorEventInput: document.getElementById("majorEventInput"),
    majorEventsEditList: document.getElementById("majorEventsEditList"),
    wakeTimeInput: document.getElementById("wakeTimeInput"),
    sleepStartInput: document.getElementById("sleepStartInput"),
    sleepEndInput: document.getElementById("sleepEndInput"),
    wakeNotesInput: document.getElementById("wakeNotesInput"),
    sleepNotesInput: document.getElementById("sleepNotesInput"),
    entryForm: document.getElementById("entryForm"),
    entryId: document.getElementById("entryId"),
    startInput: document.getElementById("startInput"),
    endInput: document.getElementById("endInput"),
    titleInput: document.getElementById("titleInput"),
    notesInput: document.getElementById("notesInput"),
    saveEntryBtn: document.getElementById("saveEntryBtn"),
    cancelEditBtn: document.getElementById("cancelEditBtn"),
  };
}

function on(el, evt, fn) {
  if (!el) return;
  el.addEventListener(evt, fn);
}

function logMissingElement(id, feature) {
  const key = `${id}:${feature}`;
  if (missingFeatureLog.has(key)) return;
  missingFeatureLog.add(key);
  console.error(`[Daily Timetable] Missing required element #${id} for ${feature}.`);
}

function bindEvents() {
  if (!els.prevDayBtn) logMissingElement("prevDayBtn", "day navigation");
  if (!els.nextDayBtn) logMissingElement("nextDayBtn", "day navigation");
  if (!els.editDayBtn) logMissingElement("editDayBtn", "plan mode entry");
  if (!els.doneBtn) logMissingElement("doneBtn", "plan mode exit");

  on(els.prevDayBtn, "click", () => {
    selectedDate = addDays(selectedDate, -1);
    planMode = false;
    ensureDay(selectedDate);
    render();
  });

  on(els.nextDayBtn, "click", () => {
    selectedDate = addDays(selectedDate, +1);
    planMode = false;
    ensureDay(selectedDate);
    render();
  });

  on(els.planDayBtn, "click", () => {
    planMode = true;
    render();
  });

  on(els.editDayBtn, "click", () => {
    planMode = true;
    render();
  });

  on(els.doneBtn, "click", () => {
    planMode = false;
    resetEntryForm();
    render();
  });

  on(els.majorEventForm, "submit", (event) => {
    event.preventDefault();
    if (!planMode) return;
    if (!els.majorEventInput) {
      logMissingElement("majorEventInput", "major events editor");
      return;
    }

    const value = els.majorEventInput.value.trim();
    if (!value) return;

    getCurrentDay().majorEvents.push(value);
    els.majorEventInput.value = "";
    persistAndRender();
  });

  on(els.majorEventsEditList, "click", (event) => {
    if (!planMode) return;

    const target = event.target.closest("button[data-event-index]");
    if (!target) return;

    const index = Number(target.dataset.eventIndex);
    const day = getCurrentDay();
    if (Number.isInteger(index) && day.majorEvents[index] !== undefined) {
      day.majorEvents.splice(index, 1);
      persistAndRender();
    }
  });

  // Sleep/Wake is configured in Plan Mode and persisted into day.wake/day.sleep.
  [els.wakeTimeInput, els.sleepStartInput, els.sleepEndInput, els.wakeNotesInput, els.sleepNotesInput].forEach((input) => {
    on(input, "change", () => {
      if (!planMode) return;
      const day = getCurrentDay();
      const wakeValue = (els.wakeTimeInput?.value || "").trim();
      const sleepStart = (els.sleepStartInput?.value || "").trim();
      const sleepEnd = (els.sleepEndInput?.value || "").trim();

      day.wake.set = Boolean(wakeValue);
      day.wake.time = wakeValue || state.defaults.wakeTime;
      day.wake.notes = (els.wakeNotesInput?.value || "").trim();

      day.sleep.set = Boolean(sleepStart);
      day.sleep.start = sleepStart || state.defaults.sleepTime;
      day.sleep.end = sleepEnd;
      day.sleep.notes = (els.sleepNotesInput?.value || "").trim();

      // Keep legacy anchors in sync for backward compatibility.
      day.anchors.wake.time = day.wake.time;
      day.anchors.wake.notes = day.wake.notes;
      day.anchors.sleep.time = day.sleep.start;
      day.anchors.sleep.notes = day.sleep.notes;
      persistAndRender();
    });
  });

  on(els.startInput, "input", () => {
    if (startProgrammaticUpdate) return;
    startWasAutoFilled = false;
  });

  on(els.endInput, "change", () => {
    const endValue = (els.endInput?.value || "").trim();
    const startValue = (els.startInput?.value || "").trim();
    if (!endValue) return;

    if (!startValue || startWasAutoFilled) {
      applyAutoStart(endValue);
    }
  });

  on(els.entryForm, "submit", (event) => {
    event.preventDefault();
    if (!planMode) return;
    saveEntry();
  });

  on(els.cancelEditBtn, "click", () => {
    resetEntryForm();
  });

  on(els.entriesList, "click", (event) => {
    if (!planMode) return;

    const actionBtn = event.target.closest("button[data-action]");
    if (!actionBtn) return;

    const action = actionBtn.dataset.action;
    const id = actionBtn.dataset.id;
    if (!id) return;

    if (action === "delete") deleteEntry(id);
    if (action === "edit") startEditEntry(id);
  });
}

function saveEntry() {
  if (!els.startInput || !els.endInput || !els.titleInput || !els.notesInput || !els.entryId) {
    logMissingElement("entryForm fields", "schedule editor");
    return;
  }

  const start = els.startInput.value;
  const end = els.endInput.value;
  const title = els.titleInput.value.trim();
  const notes = els.notesInput.value.trim();

  if (!start || !end || !title) return;

  const day = getCurrentDay();
  const id = els.entryId.value || generateId();
  const payload = { id, start, end, title, notes };
  const isEditing = Boolean(els.entryId.value);

  const existingIndex = day.entries.findIndex((entry) => entry.id === id);
  if (existingIndex > -1) {
    day.entries[existingIndex] = payload;
  } else {
    day.entries.push(payload);
  }

  day.entries.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  if (isEditing) {
    resetEntryForm();
  } else {
    prepareFormAfterAdd(end);
  }
  persistAndRender();
}

function startEditEntry(id) {
  if (!els.entryId || !els.startInput || !els.endInput || !els.titleInput || !els.notesInput) {
    logMissingElement("entryForm fields", "schedule editor");
    return;
  }

  const entry = getCurrentDay().entries.find((item) => item.id === id);
  if (!entry) return;

  els.entryId.value = entry.id;
  els.startInput.value = entry.start;
  els.endInput.value = entry.end;
  els.titleInput.value = entry.title;
  els.notesInput.value = entry.notes || "";
  els.saveEntryBtn.textContent = "Save Changes";
  els.cancelEditBtn.classList.remove("hidden");
  startWasAutoFilled = false;
  els.titleInput.focus();
}

function deleteEntry(id) {
  const day = getCurrentDay();
  day.entries = day.entries.filter((entry) => entry.id !== id);
  if (els.entryId.value === id) resetEntryForm();
  persistAndRender();
}

function resetEntryForm() {
  if (els.entryForm) els.entryForm.reset();
  if (els.entryId) els.entryId.value = "";
  if (els.saveEntryBtn) els.saveEntryBtn.textContent = "Add Block";
  if (els.cancelEditBtn) els.cancelEditBtn.classList.add("hidden");
  startWasAutoFilled = false;
}

function applyAutoStart(value) {
  if (!els.startInput) return;
  startProgrammaticUpdate = true;
  els.startInput.value = value;
  startProgrammaticUpdate = false;
  startWasAutoFilled = true;
}

function prepareFormAfterAdd(nextStart) {
  if (!els.entryId || !els.endInput || !els.titleInput || !els.notesInput) return;
  els.entryId.value = "";
  if (els.saveEntryBtn) els.saveEntryBtn.textContent = "Add Block";
  if (els.cancelEditBtn) els.cancelEditBtn.classList.add("hidden");
  applyAutoStart(nextStart);
  els.endInput.value = "";
  els.titleInput.value = "";
  els.notesInput.value = "";
}

// Defensive parser keeps legacy shape and sanitizes malformed local storage.
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(BASE_STATE);

    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch {
    return structuredClone(BASE_STATE);
  }
}

function normalizeState(input) {
  const output = structuredClone(BASE_STATE);

  if (input && typeof input === "object") {
    const defaults = input.defaults || {};
    output.defaults.wakeTime = isTime(defaults.wakeTime) ? defaults.wakeTime : BASE_STATE.defaults.wakeTime;
    output.defaults.sleepTime = isTime(defaults.sleepTime) ? defaults.sleepTime : BASE_STATE.defaults.sleepTime;
    output.defaults.nightOwlEnabledByDefault = Boolean(defaults.nightOwlEnabledByDefault);

    if (input.days && typeof input.days === "object") {
      for (const [date, day] of Object.entries(input.days)) {
        if (!isISODate(date) || !day || typeof day !== "object") continue;

        const legacyWakeTime = isTime(day.anchors?.wake?.time) ? day.anchors.wake.time : output.defaults.wakeTime;
        const legacyWakeNotes = typeof day.anchors?.wake?.notes === "string" ? day.anchors.wake.notes : "";
        const legacySleepStart = isTime(day.anchors?.sleep?.time) ? day.anchors.sleep.time : output.defaults.sleepTime;
        const legacySleepNotes = typeof day.anchors?.sleep?.notes === "string" ? day.anchors.sleep.notes : "";

        const wakeTime = isTime(day.wake?.time) ? day.wake.time : legacyWakeTime;
        const wakeNotes = typeof day.wake?.notes === "string" ? day.wake.notes : legacyWakeNotes;
        const wakeSet = Boolean(day.wake?.set ?? day.sleepWake?.wakeSet ?? day.wakeSet ?? false) && isTime(wakeTime);

        const sleepStart = isTime(day.sleep?.start) ? day.sleep.start : legacySleepStart;
        const sleepEnd = isTime(day.sleep?.end) ? day.sleep.end : "";
        const sleepNotes = typeof day.sleep?.notes === "string" ? day.sleep.notes : legacySleepNotes;
        const sleepSet = Boolean(day.sleep?.set ?? day.sleepWake?.sleepSet ?? day.sleepSet ?? false) && isTime(sleepStart);

        output.days[date] = {
          date,
          nightOwl: Boolean(day.nightOwl),
          wake: { time: wakeTime, notes: wakeNotes, set: wakeSet },
          sleep: { start: sleepStart, end: sleepEnd, notes: sleepNotes, set: sleepSet },
          majorEvents: Array.isArray(day.majorEvents)
            ? day.majorEvents.filter((event) => typeof event === "string").map((event) => event.trim()).filter(Boolean)
            : [],
          entries: normalizeEntries(day.entries),
          anchors: {
            wake: {
              time: wakeTime,
              notes: wakeNotes,
            },
            sleep: {
              time: sleepStart,
              notes: sleepNotes,
            },
          },
        };
      }
    }
  }

  return output;
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return [];

  return entries
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      id: typeof entry.id === "string" && entry.id ? entry.id : generateId(),
      start: isTime(entry.start) ? entry.start : "00:00",
      end: isTime(entry.end) ? entry.end : "00:00",
      title: typeof entry.title === "string" ? entry.title.trim() : "",
      notes: typeof entry.notes === "string" ? entry.notes : "",
    }))
    .filter((entry) => entry.title)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

function ensureDay(date) {
  if (state.days[date]) return;

  state.days[date] = {
    date,
    nightOwl: state.defaults.nightOwlEnabledByDefault,
    wake: { time: state.defaults.wakeTime, notes: "", set: false },
    sleep: { start: state.defaults.sleepTime, end: "", notes: "", set: false },
    majorEvents: [],
    entries: [],
    anchors: {
      wake: { time: state.defaults.wakeTime, notes: "" },
      sleep: { time: state.defaults.sleepTime, notes: "" },
    },
  };

  saveState();
}

function getCurrentDay() {
  ensureDay(selectedDate);
  return state.days[selectedDate];
}

function persistAndRender(full = true) {
  saveState();
  if (full) render();
  else renderSleepWakeEditor();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  renderHeader();
  renderModeControls();
  renderMajorEventsView();
  renderNowNext();
  renderEntries();
  renderPlanningPanel();
}

function renderHeader() {
  const date = new Date(`${selectedDate}T12:00:00`);
  const today = getTodayISO();
  const formatted = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);

  if (els.dateLabel) {
    els.dateLabel.textContent = formatted;
  } else {
    logMissingElement("dateLabel", "date display");
  }

  if (els.dayLabel) {
    const showToday = selectedDate === today;
    els.dayLabel.textContent = showToday ? "Today" : "";
    els.dayLabel.classList.toggle("hidden", !showToday);
  } else {
    logMissingElement("dayLabel", "today indicator");
  }
}

function renderModeControls() {
  if (!els.editDayBtn || !els.doneBtn || !els.emptyState) return;
  const day = getCurrentDay();
  const unplanned = isUnplannedDay(day);

  els.editDayBtn.classList.toggle("hidden", planMode || unplanned);
  els.doneBtn.classList.toggle("hidden", !planMode);
  els.emptyState.classList.toggle("hidden", planMode || !unplanned);
}

function renderMajorEventsView() {
  if (!els.majorEventsView || !els.majorEventsViewList) return;
  const events = getCurrentDay().majorEvents;
  const showCompact = !planMode && events.length > 0;

  els.majorEventsView.classList.toggle("hidden", !showCompact);
  if (!showCompact) return;

  els.majorEventsViewList.innerHTML = events
    .map((event) => `<li class="major-item"><span>${escapeHTML(event)}</span></li>`)
    .join("");
}

function renderNowNext() {
  if (!els.nowNextStrip || !els.nowLine || !els.nextLine) return;
  const showNowNext = selectedDate === getTodayISO();
  els.nowNextStrip.classList.toggle("hidden", !showNowNext);
  if (!showNowNext) return;

  const day = getCurrentDay();
  const blocks = getTimedBlocks(day);
  const nowMins = getNowMinutes();

  const current = blocks.find((item) => isActiveEntryNow(item, nowMins));
  const next = blocks.filter((item) => toMinutes(item.start) > nowMins).sort((a, b) => toMinutes(a.start) - toMinutes(b.start))[0];

  els.nowLine.textContent = current ? `Now: ${formatEntryLabel(current)}` : "Now: No active block";
  els.nextLine.textContent = next ? `Next: ${formatEntryLabel(next)}` : "Next: Nothing scheduled";
}

function renderEntries() {
  if (!els.entriesList) return;
  const day = getCurrentDay();
  const items = getScheduleItems(day);
  const isToday = selectedDate === getTodayISO();
  const nowMins = getNowMinutes();

  if (!items.length) {
    els.entriesList.innerHTML = isUnplannedDay(day)
      ? ""
      : `<li class="entry-card"><p class="entry-notes">No blocks scheduled.</p></li>`;
    return;
  }

  els.entriesList.innerHTML = items
    .map((item) => renderScheduleItem(item, isToday, nowMins))
    .join("");
}

function renderScheduleItem(item, isToday, nowMins) {
  const overnight = item.kind !== "wake" && item.end && toMinutes(item.end) < toMinutes(item.start);
  const isTimedBlock = item.kind !== "wake" && item.end;
  const active = isToday && isTimedBlock && isActiveEntryNow(item, nowMins);

  let timeLabel = "";
  if (item.kind === "wake") {
    timeLabel = "";
  } else if (item.end) {
    const startFmt = formatClockTime(item.start);
    const endFmt = formatClockTime(item.end);
    timeLabel = `${startFmt}-${endFmt} ${overnight ? `<span class="small">(+1 day)</span>` : ""}`;
  } else {
    timeLabel = formatClockTime(item.start);
  }

  const actions =
    planMode && item.kind === "entry"
      ? `<div class="entry-actions-inline">
          <button class="btn ghost" type="button" data-action="edit" data-id="${item.id}">Edit</button>
          <button class="btn danger" type="button" data-action="delete" data-id="${item.id}">Delete</button>
        </div>`
      : "";

  const rowClass =
    item.kind === "wake"
      ? "entry-card wake-marker"
      : item.kind === "sleep"
        ? `entry-card sleep-block ${active ? "active" : ""}`
        : `entry-card ${active ? "active" : ""}`;

  return `
    <li class="${rowClass.trim()}">
      <div class="entry-row">
        <div class="entry-main">
          ${timeLabel ? `<span class="entry-time">${timeLabel}</span>` : ""}
          <strong class="entry-title">${escapeHTML(item.title)}</strong>
        </div>
        ${actions}
      </div>
      ${item.notes ? `<p class="entry-notes">${escapeHTML(item.notes)}</p>` : ""}
    </li>
  `;
}

function getScheduleItems(day) {
  const items = day.entries.map((entry) => ({ ...entry, kind: "entry" }));

  if (day.wake?.set && isTime(day.wake.time)) {
    items.push({
      kind: "wake",
      start: day.wake.time,
      title: `Wake up — ${formatClockTime(day.wake.time)}`,
      notes: day.wake.notes || "",
    });
  }

  if (day.sleep?.set && isTime(day.sleep.start)) {
    const sleepRange = day.sleep.end
      ? `${formatClockTime(day.sleep.start)}-${formatClockTime(day.sleep.end)}`
      : `${formatClockTime(day.sleep.start)}`;
    items.push({
      kind: "sleep",
      start: day.sleep.start,
      end: isTime(day.sleep.end) ? day.sleep.end : "",
      title: `Sleep — ${sleepRange}`,
      notes: day.sleep.notes || "",
    });
  }

  items.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  return items;
}

function getTimedBlocks(day) {
  const blocks = day.entries.map((entry) => ({ start: entry.start, end: entry.end, title: entry.title }));
  if (day.sleep?.set && isTime(day.sleep.start) && isTime(day.sleep.end)) {
    blocks.push({ start: day.sleep.start, end: day.sleep.end, title: "Sleep" });
  }
  return blocks.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

function renderPlanningPanel() {
  if (!els.planningPanel) return;
  els.planningPanel.classList.toggle("hidden", !planMode);
  if (els.sleepWakeEditor) els.sleepWakeEditor.classList.toggle("hidden", !planMode);

  if (!planMode) return;

  renderMajorEventsEditor();
  renderSleepWakeEditor();
}

function renderMajorEventsEditor() {
  if (!els.majorEventsEditList) return;
  const events = getCurrentDay().majorEvents;

  if (!events.length) {
    els.majorEventsEditList.innerHTML = "";
    return;
  }

  els.majorEventsEditList.innerHTML = events
    .map(
      (event, index) => `
        <li class="major-item">
          <span>${escapeHTML(event)}</span>
          <button class="btn danger" type="button" data-event-index="${index}" aria-label="Remove event">Delete</button>
        </li>
      `,
    )
    .join("");
}

function renderSleepWakeEditor() {
  const day = getCurrentDay();
  if (els.wakeTimeInput) els.wakeTimeInput.value = day.wake?.set ? day.wake.time : "";
  if (els.sleepStartInput) els.sleepStartInput.value = day.sleep?.set ? day.sleep.start : "";
  if (els.sleepEndInput) els.sleepEndInput.value = day.sleep?.end || "";
  if (els.wakeNotesInput) els.wakeNotesInput.value = day.wake?.notes || "";
  if (els.sleepNotesInput) els.sleepNotesInput.value = day.sleep?.notes || "";
}

function startNowNextTicker() {
  if (nowNextTimer) clearInterval(nowNextTimer);
  nowNextTimer = setInterval(() => {
    if (selectedDate !== getTodayISO()) return;
    renderNowNext();
    renderEntries();
  }, 30000);
}

function isUnplannedDay(day) {
  return day.majorEvents.length === 0 && day.entries.length === 0 && !day.wake?.set && !day.sleep?.set;
}

function getTodayISO() {
  return toISO(new Date());
}

function toISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function formatClockTime(time) {
  if (!isTime(time)) return "";
  const [hourRaw, minute] = time.split(":").map(Number);
  const period = hourRaw >= 12 ? "PM" : "AM";
  const hour12 = hourRaw % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function getNowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function isActiveEntryNow(entry, nowMins) {
  const start = toMinutes(entry.start);
  const end = toMinutes(entry.end);
  if (end < start) return nowMins >= start || nowMins < end;
  return nowMins >= start && nowMins < end;
}

function formatEntryLabel(entry) {
  const overnight = toMinutes(entry.end) < toMinutes(entry.start);
  return `${entry.start}-${entry.end}${overnight ? " (+1 day)" : ""} ${entry.title}`;
}

function isTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function escapeHTML(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(text).replace(/[&<>"']/g, (char) => map[char]);
}

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
