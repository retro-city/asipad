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

function calendarBody() {
  const now = new Date();
  const weekday = now.toLocaleDateString("nb-NO", { weekday: "long" });
  const month = now.toLocaleDateString("nb-NO", { month: "long" });
  return `<div class="calendar-big">
    <div class="weekday">${weekday}</div>
    <div class="day">${now.getDate()}</div>
    <div class="month">${month}</div>
  </div>`;
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
  if (e.target?.classList?.contains("start-game")) loadGameIframe();
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
