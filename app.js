const STORAGE_KEY = "dailyPlanner_v1";

const BASE_STATE = {
  defaults: {
    wakeTime: "04:30",
    sleepTime: "21:00",
    nightOwlEnabledByDefault: false,
  },
  days: {},
};

const els = {
  dayLabel: document.getElementById("dayLabel"),
  currentDateLabel: document.getElementById("currentDateLabel"),
  prevDayBtn: document.getElementById("prevDayBtn"),
  nextDayBtn: document.getElementById("nextDayBtn"),
  executionModeToggle: document.getElementById("executionModeToggle"),
  jumpDate: document.getElementById("jumpDate"),
  majorEventForm: document.getElementById("majorEventForm"),
  majorEventInput: document.getElementById("majorEventInput"),
  majorEventsList: document.getElementById("majorEventsList"),
  nightOwlToggle: document.getElementById("nightOwlToggle"),
  wakeTimeInput: document.getElementById("wakeTimeInput"),
  sleepTimeInput: document.getElementById("sleepTimeInput"),
  wakeNotesInput: document.getElementById("wakeNotesInput"),
  sleepNotesInput: document.getElementById("sleepNotesInput"),
  sleepHint: document.getElementById("sleepHint"),
  resetAnchorsBtn: document.getElementById("resetAnchorsBtn"),
  entryForm: document.getElementById("entryForm"),
  entryId: document.getElementById("entryId"),
  startInput: document.getElementById("startInput"),
  endInput: document.getElementById("endInput"),
  titleInput: document.getElementById("titleInput"),
  notesInput: document.getElementById("notesInput"),
  saveEntryBtn: document.getElementById("saveEntryBtn"),
  cancelEditBtn: document.getElementById("cancelEditBtn"),
  entriesList: document.getElementById("entriesList"),
  nowNextStrip: document.getElementById("nowNextStrip"),
  nowLine: document.getElementById("nowLine"),
  nextLine: document.getElementById("nextLine"),
};

let state = loadState();
let selectedDate = getTodayISO();
let nowNextTimer = null;
ensureDay(selectedDate);
render();
bindEvents();
startNowNextTicker();

function bindEvents() {
  els.prevDayBtn.addEventListener("click", () => moveDay(-1));
  els.nextDayBtn.addEventListener("click", () => moveDay(1));

  els.jumpDate.addEventListener("change", () => {
    if (!els.jumpDate.value) return;
    selectDate(els.jumpDate.value);
  });

  els.executionModeToggle.addEventListener("change", () => {
    getCurrentDay().executionMode = els.executionModeToggle.checked;
    resetEntryForm();
    persistAndRender();
  });

  els.majorEventForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (getCurrentDay().executionMode) return;
    const value = els.majorEventInput.value.trim();
    if (!value) return;

    getCurrentDay().majorEvents.push(value);
    els.majorEventInput.value = "";
    persistAndRender();
  });

  els.majorEventsList.addEventListener("click", (event) => {
    if (getCurrentDay().executionMode) return;
    const target = event.target.closest("button[data-event-index]");
    if (!target) return;

    const index = Number(target.dataset.eventIndex);
    const day = getCurrentDay();
    if (Number.isInteger(index) && day.majorEvents[index] !== undefined) {
      day.majorEvents.splice(index, 1);
      persistAndRender();
    }
  });

  // Keep anchor fields editable per day and persist instantly on change.
  [els.wakeTimeInput, els.sleepTimeInput, els.wakeNotesInput, els.sleepNotesInput].forEach((input) => {
    input.addEventListener("change", () => {
      const day = getCurrentDay();
      day.anchors.wake.time = els.wakeTimeInput.value || day.anchors.wake.time;
      day.anchors.sleep.time = els.sleepTimeInput.value || day.anchors.sleep.time;
      day.anchors.wake.notes = (els.wakeNotesInput.value || "").trim();
      day.anchors.sleep.notes = (els.sleepNotesInput.value || "").trim();
      persistAndRender(false);
    });
  });

  els.nightOwlToggle.addEventListener("change", () => {
    getCurrentDay().nightOwl = els.nightOwlToggle.checked;
    persistAndRender(false);
  });

  els.resetAnchorsBtn.addEventListener("click", () => {
    const day = getCurrentDay();
    day.anchors.wake.time = state.defaults.wakeTime;
    day.anchors.sleep.time = state.defaults.sleepTime;
    day.anchors.wake.notes = "";
    day.anchors.sleep.notes = "";
    persistAndRender(false);
  });

  els.entryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveEntry();
  });

  els.cancelEditBtn.addEventListener("click", () => {
    resetEntryForm();
  });

  els.entriesList.addEventListener("click", (event) => {
    const actionBtn = event.target.closest("button[data-action]");
    if (!actionBtn) return;

    const action = actionBtn.dataset.action;
    const id = actionBtn.dataset.id;
    if (!id) return;

    if (action === "delete") {
      deleteEntry(id);
    }

    if (action === "edit") {
      startEditEntry(id);
    }
  });
}

function saveEntry() {
  if (getCurrentDay().executionMode) return;
  const start = els.startInput.value;
  const end = els.endInput.value;
  const title = els.titleInput.value.trim();
  const notes = els.notesInput.value.trim();

  if (!start || !end || !title) return;

  const day = getCurrentDay();
  const id = els.entryId.value || generateId();
  const payload = { id, start, end, title, notes };

  const existingIndex = day.entries.findIndex((entry) => entry.id === id);
  if (existingIndex > -1) {
    day.entries[existingIndex] = payload;
  } else {
    day.entries.push(payload);
  }

  day.entries.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  resetEntryForm();
  persistAndRender();
}

function startEditEntry(id) {
  if (getCurrentDay().executionMode) return;
  const entry = getCurrentDay().entries.find((item) => item.id === id);
  if (!entry) return;

  els.entryId.value = entry.id;
  els.startInput.value = entry.start;
  els.endInput.value = entry.end;
  els.titleInput.value = entry.title;
  els.notesInput.value = entry.notes || "";
  els.saveEntryBtn.textContent = "Save Changes";
  els.cancelEditBtn.classList.remove("hidden");
  els.titleInput.focus();
}

function deleteEntry(id) {
  if (getCurrentDay().executionMode) return;
  const day = getCurrentDay();
  day.entries = day.entries.filter((entry) => entry.id !== id);
  if (els.entryId.value === id) resetEntryForm();
  persistAndRender();
}

function resetEntryForm() {
  els.entryForm.reset();
  els.entryId.value = "";
  els.saveEntryBtn.textContent = "Add Block";
  els.cancelEditBtn.classList.add("hidden");
}

function moveDay(amount) {
  const date = new Date(`${selectedDate}T12:00:00`);
  date.setDate(date.getDate() + amount);
  selectDate(toISO(date));
}

function selectDate(isoDate) {
  selectedDate = isoDate;
  ensureDay(selectedDate);
  resetEntryForm();
  render();
}

// Defensive parser ensures a valid structure even with malformed storage data.
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

        output.days[date] = {
          date,
          nightOwl: Boolean(day.nightOwl),
          executionMode: Boolean(day.executionMode),
          majorEvents: Array.isArray(day.majorEvents)
            ? day.majorEvents.filter((event) => typeof event === "string").map((event) => event.trim()).filter(Boolean)
            : [],
          entries: normalizeEntries(day.entries),
          anchors: {
            wake: {
              time: isTime(day.anchors?.wake?.time) ? day.anchors.wake.time : output.defaults.wakeTime,
              notes: typeof day.anchors?.wake?.notes === "string" ? day.anchors.wake.notes : "",
            },
            sleep: {
              time: isTime(day.anchors?.sleep?.time) ? day.anchors.sleep.time : output.defaults.sleepTime,
              notes: typeof day.anchors?.sleep?.notes === "string" ? day.anchors.sleep.notes : "",
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
    executionMode: false,
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
  if (full) {
    render();
  } else {
    renderAnchors();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  const date = new Date(`${selectedDate}T12:00:00`);
  const today = getTodayISO();
  const day = getCurrentDay();

  els.currentDateLabel.textContent = date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  els.dayLabel.textContent = selectedDate === today ? "Today" : "Selected Day";
  els.jumpDate.value = selectedDate;
  els.executionModeToggle.checked = day.executionMode;

  renderMajorEvents();
  renderAnchors();
  renderNowNext();
  renderEntries();
  applyExecutionModeUI();
}

function renderMajorEvents() {
  const day = getCurrentDay();
  const readOnly = day.executionMode;
  const events = getCurrentDay().majorEvents;

  if (!events.length) {
    els.majorEventsList.innerHTML = `<li class="empty">No major events yet.</li>`;
    return;
  }

  els.majorEventsList.innerHTML = events
    .map(
      (event, index) => `
      <li class="chip">
        <span>${escapeHTML(event)}</span>
        ${readOnly ? "" : `<button class="btn danger" type="button" data-event-index="${index}" aria-label="Remove event">x</button>`}
      </li>
    `,
    )
    .join("");
}

function renderAnchors() {
  const day = getCurrentDay();
  const sleep = day.anchors.sleep.time;

  els.nightOwlToggle.checked = day.nightOwl;
  els.wakeTimeInput.value = day.anchors.wake.time;
  els.sleepTimeInput.value = sleep;
  els.wakeNotesInput.value = day.anchors.wake.notes;
  els.sleepNotesInput.value = day.anchors.sleep.notes;

  const outOfNormal = !isSleepInNormalRange(sleep);
  const showWarning = !day.nightOwl && outOfNormal;
  els.sleepHint.classList.toggle("warn", showWarning);
  els.sleepHint.textContent = showWarning
    ? "Sleep time is outside the recommended 20:00-02:00 range."
    : "Recommended sleep window: 20:00-02:00 when Night Owl is off.";
}

function renderEntries() {
  const day = getCurrentDay();
  const entries = day.entries;
  const isToday = selectedDate === getTodayISO();
  const nowMins = getNowMinutes();

  if (!entries.length) {
    els.entriesList.innerHTML = `<li class="empty">No blocks scheduled.</li>`;
    return;
  }

  els.entriesList.innerHTML = entries
    .map((entry) => {
      const overnight = toMinutes(entry.end) < toMinutes(entry.start);
      const active = isToday && isActiveEntryNow(entry, nowMins);
      return `
        <li class="entry-card ${active ? "active" : ""}">
          <div class="entry-row">
            <div class="entry-main">
              <span class="entry-time">${entry.start}-${entry.end} ${overnight ? `<span class="small">(+1 day)</span>` : ""}</span>
              <strong class="entry-title">${escapeHTML(entry.title)}</strong>
            </div>
            ${
              day.executionMode
                ? ""
                : `<div class="entry-actions-inline">
              <button class="btn ghost" type="button" data-action="edit" data-id="${entry.id}">Edit</button>
              <button class="btn danger" type="button" data-action="delete" data-id="${entry.id}">Delete</button>
            </div>`
            }
          </div>
          ${entry.notes ? `<p class="entry-notes">${escapeHTML(entry.notes)}</p>` : ""}
        </li>
      `;
    })
    .join("");
}

function renderNowNext() {
  if (selectedDate !== getTodayISO()) {
    els.nowNextStrip.classList.add("muted");
    els.nowLine.textContent = "Now/Next only shows for Today";
    els.nextLine.textContent = "";
    return;
  }

  els.nowNextStrip.classList.remove("muted");
  const entries = getCurrentDay().entries;
  const nowMins = getNowMinutes();

  const current = entries.find((entry) => isActiveEntryNow(entry, nowMins));
  const next = entries
    .filter((entry) => toMinutes(entry.start) > nowMins)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))[0];

  els.nowLine.textContent = current
    ? `Now: ${formatEntryLabel(current)}`
    : "Now: No active block";
  els.nextLine.textContent = next
    ? `Next: ${formatEntryLabel(next)}`
    : "Next: Nothing scheduled";
}

function applyExecutionModeUI() {
  const isExecutionMode = getCurrentDay().executionMode;
  els.entryForm.classList.toggle("hidden", isExecutionMode);
  els.majorEventForm.classList.toggle("hidden", isExecutionMode);
}

function startNowNextTicker() {
  if (nowNextTimer) clearInterval(nowNextTimer);
  nowNextTimer = setInterval(() => {
    if (selectedDate !== getTodayISO()) return;
    renderNowNext();
    renderEntries();
  }, 30000);
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

function isISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
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

function isSleepInNormalRange(time) {
  const mins = toMinutes(time);
  return mins >= 20 * 60 || mins <= 2 * 60;
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
