const PAGES = {
  kalender: { title: "Kalender", body: calendarBody },
  tegne:    { title: "Tegne",    body: comingSoon },
  bilder:   { title: "Bilder",   body: comingSoon },
  musikk:   { title: "Musikk",   body: comingSoon },
  lese:     { title: "Lese",     body: comingSoon },
  spill:    { title: "Spill",    body: gameBody, fullbleed: true, url: "https://opentd2.rykroken.net/" },
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

document.querySelectorAll(".tile").forEach((el) => {
  el.addEventListener("click", () => {
    const route = el.dataset.route;
    if (route) showPage(route);
  });
});

pageBody.addEventListener("click", (e) => {
  if (e.target?.classList?.contains("start-game")) return loadGameIframe();
  const action = e.target?.closest?.("[data-action]")?.dataset?.action;
  if (action === "prev") shiftCalendar(-1);
  else if (action === "next") shiftCalendar(1);
});

$("#back").addEventListener("click", showHome);

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
