const PAGES = {
  kalender:      { title: "Kalender",      body: calendarBody },
  lese:          { title: "Lese",          body: leseBody },
  skrive:        { title: "Skrive",        body: comingSoon },
  tall:          { title: "Tall",          body: comingSoon },
  jobb:          { title: "Jobb",          body: jobbBody },
  innstillinger: { title: "Innstillinger", body: settingsBody },
  bakgrunn:      { title: "Bakgrunn",      body: backgroundBody, parent: "innstillinger" },
};

const $ = (s) => document.querySelector(s);
const home = $("#home");
const page = $("#page");
const pageTitle = $("#page-title");
const pageBody = $("#page-body");

function fmtDate(d) {
  // "torsdag 30. april" — CSS title-cases it to "Torsdag 30. April".
  return d.toLocaleDateString("nb-NO", {
    weekday: "long", day: "numeric", month: "long"
  });
}

function comingSoon() {
  return `<div>Kommer snart!</div>`;
}

function leseBody() {
  // Reading-practice text. Update LESE_LINES below to change.
  return `<div class="lese-content">${LESE_LINES.map((l) => `<p>${l}</p>`).join("")}</div>`;
}

const LESE_LINES = [
  "HEI!",
  "VI ER VELDIG GLAD I DEG.",
  "DU ER VELDIG FLINK Å LESE.",
  "DU KAN LESE KATT, MUS, HUND OG TIGER.",
];

function gameBody() {
  // Two-step gate so the heavy game iframe only loads after an explicit tap
  // — keeps the home view snappy and lets "Tilbake" actually free the renderer.
  return `<button class="start-game" type="button">Start spill</button>`;
}

function loadGameIframe() {
  pageBody.innerHTML = `<iframe src="${PAGES.spill.url}" allowfullscreen referrerpolicy="no-referrer"></iframe>`;
}

// Daily events shown on the right half of the calendar page.
// Replace this list with a fetch() against a real calendar (CalDAV,
// Google Calendar, etc.) when ready — the renderer just consumes whatever
// `eventsForDate(d)` returns.
const EVENTS = [
  { match: (d) => d.getDay() === 2,                            label: "Svømming",         icon: "swim" },
  { match: (d) => d.getDay() === 3,                            label: "Musikkleik",       icon: "music" },
  { match: (d) => d.getMonth() === 4 && d.getDate() === 1,     label: "Bursdag", icon: "cake" },
];

const EVENT_ICONS = {
  swim:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="8" r="1.6"/><path d="M8 9c2 -1 5 -1 8 1"/><path d="M2 15c2 -1.5 4 -1.5 6 0s4 1.5 6 0 4 -1.5 6 0"/><path d="M2 19c2 -1.5 4 -1.5 6 0s4 1.5 6 0 4 -1.5 6 0"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="17" r="2.3" fill="currentColor"/><circle cx="17.5" cy="15" r="2.3" fill="currentColor"/><line x1="8.8" y1="17" x2="8.8" y2="6"/><line x1="19.8" y1="15" x2="19.8" y2="4"/><line x1="8.8" y1="6" x2="19.8" y2="4"/></svg>',
  cake:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="12" width="18" height="9" rx="1.2"/><path d="M3 16c3 1.6 6 1.6 9 0s6 -1.6 9 0"/><line x1="12" y1="12" x2="12" y2="6"/><path d="M12 6c-1 -0.8 -1 -2.5 0 -3 1 0.5 1 2.2 0 3z" fill="currentColor"/></svg>',
};

function eventsForDate(d) {
  return EVENTS.filter((e) => e.match(d));
}

let calendarDate = null;

function calendarBody() {
  const d = calendarDate ?? new Date();
  const weekday = d.toLocaleDateString("nb-NO", { weekday: "long" });
  const month = d.toLocaleDateString("nb-NO", { month: "long" });
  const events = eventsForDate(d);
  const isToday = sameYMD(d, new Date());
  const eventsHtml = events.length
    ? events.map((e) => `
        <div class="event">
          <div class="event-icon">${EVENT_ICONS[e.icon] ?? ""}</div>
          <div class="event-label">${e.label}</div>
        </div>`).join("")
    : `<div class="no-events">${isToday ? "Ingen avtaler i dag" : "Ingen avtaler"}</div>`;

  return `<div class="calendar-split">
    <button class="cal-nav" data-action="prev" aria-label="Forrige dag">‹</button>
    <div class="calendar-day calendar-big">
      <div class="weekday">${weekday}</div>
      <div class="day">${d.getDate()}</div>
      <div class="month">${month}</div>
    </div>
    <div class="calendar-events">
      ${eventsHtml}
    </div>
    <button class="cal-nav" data-action="next" aria-label="Neste dag">›</button>
  </div>`;
}

function sameYMD(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

function shiftCalendar(days) {
  const base = calendarDate ?? new Date();
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  calendarDate = next;
  pageBody.innerHTML = calendarBody();
}

const SETTINGS_TILES = [
  { route: "bakgrunn", title: "Bakgrunn", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M3 17l4-4 4 4 5-5 5 5"/></svg>' },
];

const SETTINGS_PLACEHOLDER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l3 16H6z"/><line x1="7.7" y1="11" x2="16.3" y2="11"/><line x1="6.7" y1="16" x2="17.3" y2="16"/><line x1="3" y1="20" x2="21" y2="20"/></svg>';

function settingsBody() {
  const tiles = [];
  for (let i = 0; i < 6; i++) {
    const t = SETTINGS_TILES[i];
    if (t) {
      tiles.push(`
        <button class="setting-tile" data-route="${t.route}">
          <div class="setting-icon">${t.icon}</div>
          <div class="setting-title">${t.title}</div>
        </button>`);
    } else {
      tiles.push(`
        <div class="setting-tile placeholder">
          <div class="setting-icon">${SETTINGS_PLACEHOLDER_ICON}</div>
        </div>`);
    }
  }
  return `<div class="settings-grid">${tiles.join("")}</div>`;
}

const BG_PAGE_SIZE = 6;
let bgList = [];
let bgPage = 0;

function backgroundBody() {
  bgPage = 0;
  loadBackgroundList();
  return `<div class="bg-loading">Laster…</div>`;
}

async function loadBackgroundList() {
  try {
    const r = await fetch("/api/backgrounds", { cache: "no-store" });
    bgList = await r.json();
  } catch (_) {
    bgList = [];
  }
  renderBgPage();
}

function renderBgPage() {
  const total = bgList.length;
  const totalPages = Math.max(1, Math.ceil(total / BG_PAGE_SIZE));
  bgPage = Math.max(0, Math.min(bgPage, totalPages - 1));
  const start = bgPage * BG_PAGE_SIZE;
  const items = bgList.slice(start, start + BG_PAGE_SIZE);
  const cells = [];
  for (let i = 0; i < BG_PAGE_SIZE; i++) {
    const b = items[i];
    if (b) {
      cells.push(`
        <button class="bg-tile ${b.current ? "current" : ""}" data-bg-id="${b.id}">
          <img src="${b.url}" alt="">
        </button>`);
    } else {
      cells.push(`<div class="bg-tile empty"></div>`);
    }
  }
  const showArrows = totalPages > 1;
  pageBody.innerHTML = `
    <div class="bg-pager">
      ${showArrows
        ? `<button class="cal-nav" data-action="bg-prev" ${bgPage === 0 ? "disabled" : ""}>‹</button>`
        : `<div class="cal-nav-spacer"></div>`}
      <div class="bg-grid">${cells.join("")}</div>
      ${showArrows
        ? `<button class="cal-nav" data-action="bg-next" ${bgPage >= totalPages - 1 ? "disabled" : ""}>›</button>`
        : `<div class="cal-nav-spacer"></div>`}
    </div>`;
}

async function pickBackground(id) {
  try {
    await fetch("/api/backgrounds/use", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    bgList = bgList.map((b) => ({ ...b, current: b.id === id }));
    renderBgPage();
    pollVersion();
  } catch (_) { /* swallow */ }
}

// --- Jobb: text editor with file picker ---

let jobs = [];
let activeJobId = null;
let activeJobTitle = "";
let activeJobContent = "";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function jobbBody() {
  activeJobId = null;
  activeJobTitle = "";
  activeJobContent = "";
  loadJobsList();
  return `
    <div class="jobb-split">
      <div class="jobb-list">
        <button class="jobb-new" data-action="job-new">+ Ny fil</button>
        <div class="jobb-items" id="jobb-items"><div class="jobb-empty-list">Laster…</div></div>
      </div>
      <div class="jobb-editor" id="jobb-editor">${jobbEditorEmpty()}</div>
    </div>`;
}

function jobbEditorEmpty() {
  return `<div class="jobb-empty">Velg en fil eller lag en ny</div>`;
}

function jobbEditorOpen() {
  const showDelete = !!activeJobId;
  return `
    <input class="jobb-title-input" id="jobb-title" placeholder="Tittel" value="${escapeHtml(activeJobTitle)}">
    <textarea class="jobb-content-input" id="jobb-content" placeholder="Skriv her…">${escapeHtml(activeJobContent)}</textarea>
    <div class="jobb-actions">
      <button class="jobb-save" data-action="job-save">Lagre</button>
      ${showDelete ? `<button class="jobb-delete" data-action="job-delete">Slett</button>` : ""}
    </div>`;
}

async function loadJobsList() {
  try {
    const r = await fetch("/api/jobs", { cache: "no-store" });
    jobs = await r.json();
  } catch (_) {
    jobs = [];
  }
  renderJobsList();
}

function renderJobsList() {
  const el = document.getElementById("jobb-items");
  if (!el) return;
  if (!jobs.length) {
    el.innerHTML = `<div class="jobb-empty-list">Ingen filer enda</div>`;
    return;
  }
  el.innerHTML = jobs.map((j) => `
    <button class="jobb-item ${j.id === activeJobId ? "active" : ""}"
            data-action="job-open" data-job-id="${j.id}">
      <div class="title">${escapeHtml(j.title)}</div>
      <div class="date">${new Date(j.mtime * 1000).toLocaleDateString("nb-NO", { day: "numeric", month: "short" })}</div>
    </button>`).join("");
}

async function openJob(id) {
  try {
    const r = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
    if (!r.ok) return;
    const data = await r.json();
    activeJobId = id;
    activeJobTitle = data.title || "";
    activeJobContent = data.content || "";
    document.getElementById("jobb-editor").innerHTML = jobbEditorOpen();
    renderJobsList();
  } catch (_) {}
}

function newJob() {
  activeJobId = null;
  activeJobTitle = "";
  activeJobContent = "";
  document.getElementById("jobb-editor").innerHTML = jobbEditorOpen();
  renderJobsList();
  setTimeout(() => document.getElementById("jobb-title")?.focus(), 0);
}

async function saveJob() {
  const title = document.getElementById("jobb-title")?.value ?? "";
  const content = document.getElementById("jobb-content")?.value ?? "";
  try {
    let data;
    if (activeJobId) {
      const r = await fetch(`/api/jobs/${activeJobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      data = await r.json();
    } else {
      const r = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      data = await r.json();
      activeJobId = data.id;
      // Re-render so the delete button appears
      document.getElementById("jobb-editor").innerHTML = jobbEditorOpen();
      restoreEditorValues(title, content);
    }
    activeJobTitle = data.title;
    activeJobContent = data.content;
    loadJobsList();
  } catch (_) {}
}

function restoreEditorValues(title, content) {
  const t = document.getElementById("jobb-title");
  const c = document.getElementById("jobb-content");
  if (t) t.value = title;
  if (c) c.value = content;
}

async function deleteJob() {
  if (!activeJobId) return;
  if (!confirm("Slette denne fila?")) return;
  try {
    await fetch(`/api/jobs/${activeJobId}`, { method: "DELETE" });
    activeJobId = null;
    activeJobTitle = "";
    activeJobContent = "";
    document.getElementById("jobb-editor").innerHTML = jobbEditorEmpty();
    loadJobsList();
  } catch (_) {}
}

function updateCalendarTile() {
  const now = new Date();
  const sub = $("#cal-date");
  const num = $("#cal-day-num");
  if (sub) sub.textContent = fmtDate(now);
  if (num) num.textContent = String(now.getDate());
}
updateCalendarTile();
setInterval(updateCalendarTile, 60_000);

function showHome() {
  home.classList.remove("hidden");
  page.classList.add("hidden");
  if (location.hash !== "" && location.hash !== "#/") {
    history.replaceState(null, "", location.pathname);
  }
}

function showPage(id) {
  const def = PAGES[id];
  if (!def) return showHome();
  if (id === "kalender") calendarDate = null; // reset to today on each entry
  pageTitle.textContent = def.title;
  pageBody.innerHTML = def.body();
  pageBody.classList.toggle("fullbleed", !!def.fullbleed);
  home.classList.add("hidden");
  page.classList.remove("hidden");
  if (location.hash !== `#/${id}`) {
    history.replaceState(null, "", `#/${id}`);
  }
}

// Use pointerup (or click as fallback) for navigation taps. On WPE WebKit
// under labwc, click occasionally didn't fire on touch — pointerup always
// does. We dedupe by tagging the event when we handle it.
function bindTap(el, fn) {
  let armed = false;
  el.addEventListener("pointerdown", () => { armed = true; });
  el.addEventListener("pointerup", (e) => {
    if (!armed) return;
    armed = false;
    fn(e);
  });
  el.addEventListener("pointercancel", () => { armed = false; });
  el.addEventListener("pointerleave", () => { armed = false; });
}

document.querySelectorAll(".tile").forEach((el) => {
  bindTap(el, () => {
    const route = el.dataset.route;
    if (route) showPage(route);
  });
});

// Sub-page tap delegation. pointerup not click — see bindTap above.
let pageBodyArmed = false;
pageBody.addEventListener("pointerdown", () => { pageBodyArmed = true; });
pageBody.addEventListener("pointercancel", () => { pageBodyArmed = false; });
pageBody.addEventListener("pointerleave", () => { pageBodyArmed = false; });
pageBody.addEventListener("pointerup", (e) => {
  if (!pageBodyArmed) return;
  pageBodyArmed = false;
  if (e.target?.classList?.contains("start-game")) return loadGameIframe();
  const action = e.target?.closest?.("[data-action]")?.dataset?.action;
  if (action === "prev") return shiftCalendar(-1);
  if (action === "next") return shiftCalendar(1);
  if (action === "bg-prev") { bgPage--; return renderBgPage(); }
  if (action === "bg-next") { bgPage++; return renderBgPage(); }
  if (action === "job-new") return newJob();
  if (action === "job-save") return saveJob();
  if (action === "job-delete") return deleteJob();
  if (action === "job-open") {
    const jobId = e.target.closest("[data-job-id]")?.dataset?.jobId;
    if (jobId) return openJob(jobId);
  }
  const route = e.target?.closest?.("[data-route]")?.dataset?.route;
  if (route && PAGES[route]) return showPage(route);
  const bgId = e.target?.closest?.("[data-bg-id]")?.dataset?.bgId;
  if (bgId) return pickBackground(bgId);
});

bindTap($("#back"), () => {
  const m = location.hash.match(/^#\/(.+)/);
  const cur = m && PAGES[m[1]];
  if (cur?.parent) showPage(cur.parent);
  else showHome();
});

window.addEventListener("hashchange", () => {
  const m = location.hash.match(/^#\/(.+)/);
  if (m) showPage(m[1]); else showHome();
});

// Initial route
const initMatch = location.hash.match(/^#\/(.+)/);
if (initMatch) showPage(initMatch[1]); else showHome();

// Power menu
const trigger = $("#power-trigger");
const menu = $("#power-menu");
const HOLD_MS = 1500;
let holdTimer = null;

function startHold() {
  trigger.classList.add("charging");
  holdTimer = setTimeout(() => {
    trigger.classList.remove("charging");
    menu.showModal();
  }, HOLD_MS);
}
function cancelHold() {
  trigger.classList.remove("charging");
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
}
trigger.addEventListener("pointerdown", (e) => { e.preventDefault(); startHold(); });
trigger.addEventListener("pointerup", cancelHold);
trigger.addEventListener("pointercancel", cancelHold);
trigger.addEventListener("pointerleave", cancelHold);

menu.addEventListener("click", async (e) => {
  const action = e.target?.dataset?.action;
  if (!action) return;
  if (action === "cancel") return menu.close();
  if (action === "shutdown" || action === "reboot") {
    for (const btn of menu.querySelectorAll("button")) btn.disabled = true;
    e.target.textContent = action === "shutdown" ? "Slår av…" : "Starter på nytt…";
    try {
      await fetch(`/api/${action}`, { method: "POST" });
    } catch (_) { /* device is going down */ }
  }
});

document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("dragstart", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => {
  if (e.key === "F5" || (e.ctrlKey && (e.key === "r" || e.key === "R"))) e.preventDefault();
});

// --- On-screen keyboard (Norwegian) ---
// Pure-HTML keyboard; auto-shows when a text input/textarea gets focus.
// Independent of wvkbd so it works regardless of compositor protocol quirks.

const OSK_LOWER = [
  ["1","2","3","4","5","6","7","8","9","0","⌫"],
  ["q","w","e","r","t","y","u","i","o","p","å"],
  ["a","s","d","f","g","h","j","k","l","ø","æ"],
  ["⇧","z","x","c","v","b","n","m",",",".","⏎"],
];
const OSK_UPPER = [
  ["1","2","3","4","5","6","7","8","9","0","⌫"],
  ["Q","W","E","R","T","Y","U","I","O","P","Å"],
  ["A","S","D","F","G","H","J","K","L","Ø","Æ"],
  ["⇧","Z","X","C","V","B","N","M","!","?","⏎"],
];

let oskEl = null;
let oskTarget = null;
let oskShift = false;

function buildOsk() {
  if (oskEl) return;
  oskEl = document.createElement("div");
  oskEl.className = "osk hidden";
  document.body.appendChild(oskEl);
  renderOsk();
  // Block focus from leaving the input when the user taps a key.
  oskEl.addEventListener("pointerdown", (e) => e.preventDefault());
  oskEl.addEventListener("mousedown",   (e) => e.preventDefault());
  oskEl.addEventListener("touchstart",  (e) => e.preventDefault(), { passive: false });
  oskEl.addEventListener("pointerup", (e) => {
    const btn = e.target.closest(".osk-key");
    if (!btn) return;
    handleOskKey(btn.dataset.key);
    // Belt-and-suspenders: ensure the input still has focus.
    if (oskTarget) oskTarget.focus();
  });
}

function renderOsk() {
  const rows = oskShift ? OSK_UPPER : OSK_LOWER;
  const grid = rows.map((row) =>
    `<div class="osk-row">${row.map((k) =>
      `<button type="button" tabindex="-1" class="osk-key ${oskClass(k)}" data-key="${k}">${k}</button>`
    ).join("")}</div>`
  ).join("");
  const bottom = `
    <div class="osk-row">
      <button type="button" tabindex="-1" class="osk-key osk-hide" data-key="hide">▾</button>
      <button type="button" tabindex="-1" class="osk-key osk-space" data-key=" ">space</button>
    </div>`;
  oskEl.innerHTML = grid + bottom;
}

function oskClass(k) {
  if (k === "⌫") return "osk-back";
  if (k === "⏎") return "osk-enter";
  if (k === "⇧") return "osk-shift" + (oskShift ? " active" : "");
  return "";
}

function handleOskKey(key) {
  if (!oskTarget) return;
  if (key === "hide")  return hideOsk();
  if (key === "⇧")     { oskShift = !oskShift; renderOsk(); return; }
  if (key === "⌫")     return oskBackspace();
  if (key === "⏎")     {
    if (oskTarget.tagName === "TEXTAREA") return oskInsert("\n");
    return; // ignore enter on single-line inputs
  }
  oskInsert(key);
  if (oskShift) { oskShift = false; renderOsk(); } // sticky shift one-shot
}

function oskInsert(text) {
  const el = oskTarget;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  el.selectionStart = el.selectionEnd = start + text.length;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function oskBackspace() {
  const el = oskTarget;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  if (start === end && start === 0) return;
  if (start === end) {
    el.value = el.value.slice(0, start - 1) + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start - 1;
  } else {
    el.value = el.value.slice(0, start) + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function showOsk(target) {
  buildOsk();
  oskTarget = target;
  oskEl.classList.remove("hidden");
  document.body.classList.add("osk-open");
}

function hideOsk() {
  if (!oskEl) return;
  oskEl.classList.add("hidden");
  oskTarget = null;
  document.body.classList.remove("osk-open");
}

document.addEventListener("focusin", (e) => {
  const t = e.target;
  if (t.tagName === "TEXTAREA" ||
      (t.tagName === "INPUT" && !["button","submit","checkbox","radio","file"].includes(t.type))) {
    showOsk(t);
  }
});

document.addEventListener("focusout", () => {
  // give the keyboard a moment to refocus the input on tap
  setTimeout(() => {
    const a = document.activeElement;
    if (oskEl && oskEl.contains(a)) return;          // focus inside keyboard, ignore
    if (!a || (a.tagName !== "INPUT" && a.tagName !== "TEXTAREA")) hideOsk();
  }, 120);
});

// Background + version polling: reload kiosk on frontend changes,
// hot-swap background image when the admin uploads a new one.
let bootVersion = null;
let bgVersion = null;

function applyBackground(version) {
  if (version > 0) {
    document.body.style.setProperty("--background-image", `url("/background?v=${version}")`);
    document.body.classList.add("has-bg");
  } else {
    document.body.classList.remove("has-bg");
    document.body.style.removeProperty("--background-image");
  }
}

async function pollVersion() {
  try {
    const r = await fetch("/api/version", { cache: "no-store" });
    const { version, background } = await r.json();
    if (bootVersion === null) bootVersion = version;
    else if (version !== bootVersion) return location.reload();
    if (bgVersion !== background) {
      bgVersion = background;
      applyBackground(background);
    }
  } catch (_) { /* server may be restarting; try again */ }
}
pollVersion();
setInterval(pollVersion, 30000);
