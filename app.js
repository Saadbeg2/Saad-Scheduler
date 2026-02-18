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
let activeEditEntryId = "";
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
    timelineWrap: document.getElementById("timelineWrap"),
    timeGutter: document.getElementById("timeGutter"),
    timelineCanvas: document.getElementById("timelineCanvas"),
    nowNextStrip: document.getElementById("nowNextStrip"),
    nowLine: document.getElementById("nowLine"),
    nextLine: document.getElementById("nextLine"),
    emptyState: document.getElementById("emptyState"),
    planDayBtn: document.getElementById("planDayBtn"),
    planningPanel: document.getElementById("planningPanel"),
    majorEventForm: document.getElementById("majorEventForm"),
    majorEventInput: document.getElementById("majorEventInput"),
    majorEventsEditList: document.getElementById("majorEventsEditList"),
    wakeTimeInput: document.getElementById("wakeTimeInput"),
    sleepTimeInput: document.getElementById("sleepTimeInput"),
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
    editSheet: document.getElementById("editSheet"),
    editEntryForm: document.getElementById("editEntryForm"),
    editEntryId: document.getElementById("editEntryId"),
    editStartInput: document.getElementById("editStartInput"),
    editEndInput: document.getElementById("editEndInput"),
    editTitleInput: document.getElementById("editTitleInput"),
    editNotesInput: document.getElementById("editNotesInput"),
    editSaveBtn: document.getElementById("editSaveBtn"),
    editDeleteBtn: document.getElementById("editDeleteBtn"),
    editCancelBtn: document.getElementById("editCancelBtn"),
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
    closeEditSheet();
    ensureDay(selectedDate);
    render();
  });

  on(els.nextDayBtn, "click", () => {
    selectedDate = addDays(selectedDate, +1);
    planMode = false;
    closeEditSheet();
    ensureDay(selectedDate);
    render();
  });

  on(els.planDayBtn, "click", () => {
    planMode = true;
    closeEditSheet();
    render();
  });

  on(els.editDayBtn, "click", () => {
    planMode = true;
    closeEditSheet();
    render();
  });

  on(els.doneBtn, "click", () => {
    planMode = false;
    resetEntryForm();
    closeEditSheet();
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
  [els.wakeTimeInput, els.sleepTimeInput, els.wakeNotesInput, els.sleepNotesInput].forEach((input) => {
    on(input, "change", () => {
      if (!planMode) return;
      const day = getCurrentDay();
      const wakeValue = (els.wakeTimeInput?.value || "").trim();
      const sleepValue = (els.sleepTimeInput?.value || "").trim();

      day.wake.set = Boolean(wakeValue);
      day.wake.time = wakeValue || state.defaults.wakeTime;
      day.wake.notes = (els.wakeNotesInput?.value || "").trim();

      day.sleep.set = Boolean(sleepValue);
      day.sleep.time = sleepValue || state.defaults.sleepTime;
      day.sleep.notes = (els.sleepNotesInput?.value || "").trim();

      // Keep legacy anchors in sync for backward compatibility.
      day.anchors.wake.time = day.wake.time;
      day.anchors.wake.notes = day.wake.notes;
      day.anchors.sleep.time = day.sleep.time;
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

  on(els.timelineCanvas, "click", (event) => {
    if (!planMode) return;
    const block = event.target.closest("[data-entry-id]");
    if (!block) return;
    const id = block.dataset.entryId;
    if (!id) return;
    openEditSheet(id);
  });

  on(els.editEntryForm, "submit", (event) => {
    event.preventDefault();
    if (!planMode) return;
    saveEditSheet();
  });

  on(els.editDeleteBtn, "click", () => {
    if (!planMode || !activeEditEntryId) return;
    deleteEntry(activeEditEntryId);
    closeEditSheet();
  });

  on(els.editCancelBtn, "click", () => {
    closeEditSheet();
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

function openEditSheet(id) {
  const entry = getCurrentDay().entries.find((item) => item.id === id);
  if (!entry || !els.editSheet || !els.editEntryForm) return;

  activeEditEntryId = id;
  if (els.editEntryId) els.editEntryId.value = id;
  if (els.editStartInput) els.editStartInput.value = entry.start;
  if (els.editEndInput) els.editEndInput.value = entry.end;
  if (els.editTitleInput) els.editTitleInput.value = entry.title;
  if (els.editNotesInput) els.editNotesInput.value = entry.notes || "";

  els.editSheet.classList.remove("hidden");
  els.editSheet.setAttribute("aria-hidden", "false");
  if (els.editTitleInput) els.editTitleInput.focus();
}

function closeEditSheet() {
  activeEditEntryId = "";
  if (els.editEntryForm) els.editEntryForm.reset();
  if (els.editEntryId) els.editEntryId.value = "";
  if (els.editSheet) {
    els.editSheet.classList.add("hidden");
    els.editSheet.setAttribute("aria-hidden", "true");
  }
}

function saveEditSheet() {
  if (!activeEditEntryId || !els.editStartInput || !els.editEndInput || !els.editTitleInput || !els.editNotesInput) return;

  const start = els.editStartInput.value;
  const end = els.editEndInput.value;
  const title = els.editTitleInput.value.trim();
  const notes = els.editNotesInput.value.trim();
  if (!start || !end || !title) return;

  const day = getCurrentDay();
  const idx = day.entries.findIndex((entry) => entry.id === activeEditEntryId);
  if (idx < 0) return;

  day.entries[idx] = { ...day.entries[idx], start, end, title, notes };
  day.entries.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  closeEditSheet();
  persistAndRender();
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
        const legacySleepTime = isTime(day.anchors?.sleep?.time) ? day.anchors.sleep.time : output.defaults.sleepTime;
        const legacySleepNotes = typeof day.anchors?.sleep?.notes === "string" ? day.anchors.sleep.notes : "";

        const wakeTime = isTime(day.wake?.time) ? day.wake.time : legacyWakeTime;
        const wakeNotes = typeof day.wake?.notes === "string" ? day.wake.notes : legacyWakeNotes;
        const wakeSet = Boolean(day.wake?.set ?? day.sleepWake?.wakeSet ?? day.wakeSet ?? false) && isTime(wakeTime);

        const sleepTime = isTime(day.sleep?.time)
          ? day.sleep.time
          : isTime(day.sleep?.start)
            ? day.sleep.start
            : isTime(day.sleep?.end)
              ? day.sleep.end
            : legacySleepTime;
        const sleepNotes = typeof day.sleep?.notes === "string" ? day.sleep.notes : legacySleepNotes;
        const sleepSet = Boolean(day.sleep?.set ?? day.sleepWake?.sleepSet ?? day.sleepSet ?? false) && isTime(sleepTime);

        output.days[date] = {
          date,
          nightOwl: Boolean(day.nightOwl),
          wake: { time: wakeTime, notes: wakeNotes, set: wakeSet },
          sleep: { time: sleepTime, notes: sleepNotes, set: sleepSet },
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
              time: sleepTime,
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
    sleep: { time: state.defaults.sleepTime, notes: "", set: false },
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
  const next = getUpcomingItems(day).find((item) => toMinutes(item.start) > nowMins);

  els.nowLine.textContent = current ? `Now: ${formatEntryLabel(current)}` : "Now: No active block";
  els.nextLine.textContent = next ? `Next: ${formatUpcomingLabel(next)}` : "Next: Nothing scheduled";
}

function renderEntries() {
  if (!els.timelineWrap || !els.timeGutter || !els.timelineCanvas) return;
  renderTimelineView();
}

function getTimedBlocks(day) {
  const blocks = day.entries.map((entry) => ({ start: entry.start, end: entry.end, title: entry.title }));
  return blocks.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

function getUpcomingItems(day) {
  const items = day.entries.map((entry) => ({ kind: "entry", start: entry.start, end: entry.end, title: entry.title }));
  if (day.wake?.set && isTime(day.wake.time)) {
    items.push({ kind: "wake", start: day.wake.time, title: "Wake up" });
  }
  if (day.sleep?.set && isTime(day.sleep.time)) {
    items.push({ kind: "sleep", start: day.sleep.time, title: "Sleep" });
  }
  return items.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

function renderTimelineView() {
  const day = getCurrentDay();
  const markers = getMarkerItems(day);
  const entries = day.entries.map((entry) => ({ ...entry, kind: "entry" }));
  const hasAnyTimelineItem = entries.length > 0 || markers.length > 0;

  if (!hasAnyTimelineItem) {
    els.timelineWrap.classList.add("hidden");
    return;
  }
  els.timelineWrap.classList.remove("hidden");

  const bounds = getTimelineBounds(entries, markers);
  const startMin = bounds.start;
  const endMin = bounds.end;
  const pxPerMinute = 1.25;
  const minBlockHeight = 28;
  const totalHeight = Math.max((endMin - startMin) * pxPerMinute, 220);

  els.timelineCanvas.style.height = `${totalHeight}px`;
  els.timeGutter.style.height = `${totalHeight}px`;

  const hourMarks = [];
  const firstHour = Math.floor(startMin / 60);
  const lastHour = Math.ceil(endMin / 60);
  for (let hour = firstHour; hour <= lastHour; hour += 1) {
    const minuteValue = hour * 60;
    const y = (minuteValue - startMin) * pxPerMinute;
    hourMarks.push(`<div class="hour-line" style="top:${y}px;"></div>`);
  }
  els.timelineCanvas.innerHTML = hourMarks.join("");

  els.timeGutter.innerHTML = hourMarks
    .map((_, idx) => {
      const hour = firstHour + idx;
      const minuteValue = hour * 60;
      const y = (minuteValue - startMin) * pxPerMinute;
      return `<div class="hour-label" style="top:${y}px;">${formatHourLabel(hour)}</div>`;
    })
    .join("");

  const timelineItemsHtml = [];

  for (const entry of entries) {
    const start = toMinutes(entry.start);
    let end = toMinutes(entry.end);
    const overnight = end < start;
    if (overnight) end += 1440;
    const top = (start - startMin) * pxPerMinute;
    const height = Math.max((end - start) * pxPerMinute, minBlockHeight);
    const timeText = `${formatClockTime(entry.start)}-${formatClockTime(entry.end)}${overnight ? " (+1 day)" : ""}`;

    timelineItemsHtml.push(`
      <article class="timeline-item ${planMode ? "editable" : ""}" data-entry-id="${entry.id}" style="top:${top}px; min-height:${minBlockHeight}px; height:${height}px;">
        <div class="textCol">
          <div class="title">${escapeHTML(entry.title)}</div>
          <div class="meta">${timeText}</div>
        </div>
      </article>
    `);
  }

  for (const marker of markers) {
    const y = (toMinutes(marker.time) - startMin) * pxPerMinute;
    timelineItemsHtml.push(`
      <article class="timeline-item marker" style="top:${y}px;">
        <div class="textCol">
          <div class="title">${escapeHTML(marker.label)}</div>
        </div>
      </article>
    `);
  }

  els.timelineCanvas.innerHTML += timelineItemsHtml.join("");
}

function getTimelineBounds(entries, markers) {
  let min = 6 * 60;
  let max = 24 * 60;
  const values = [];

  entries.forEach((entry) => {
    const start = toMinutes(entry.start);
    let end = toMinutes(entry.end);
    values.push(start);
    if (end < start) end += 1440;
    values.push(end);
  });

  markers.forEach((marker) => {
    values.push(toMinutes(marker.time));
  });

  if (values.length) {
    min = Math.min(min, ...values);
    max = Math.max(max, ...values);
  }

  const startHour = Math.floor(min / 60);
  const endHour = Math.ceil(max / 60);
  return { start: startHour * 60, end: endHour * 60 };
}

function getMarkerItems(day) {
  const items = [];
  if (day.wake?.set && isTime(day.wake.time)) {
    items.push({ kind: "wake", time: day.wake.time, label: `Wake up — ${formatClockTime(day.wake.time)}` });
  }
  if (day.sleep?.set && isTime(day.sleep.time)) {
    items.push({ kind: "sleep", time: day.sleep.time, label: `Sleep — ${formatClockTime(day.sleep.time)}` });
  }
  return items.sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
}

function formatHourLabel(hourValue) {
  const normalized = ((hourValue % 24) + 24) % 24;
  const period = normalized >= 12 ? "PM" : "AM";
  const hour12 = normalized % 12 || 12;
  return `${hour12} ${period}`;
}

function formatUpcomingLabel(item) {
  if (item.kind === "wake") return `Wake up — ${formatClockTime(item.start)}`;
  if (item.kind === "sleep") return `Sleep — ${formatClockTime(item.start)}`;
  return formatEntryLabel(item);
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
  if (els.sleepTimeInput) els.sleepTimeInput.value = day.sleep?.set ? day.sleep.time : "";
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
  return `${formatClockTime(entry.start)}-${formatClockTime(entry.end)}${overnight ? " (+1 day)" : ""} ${entry.title}`;
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
