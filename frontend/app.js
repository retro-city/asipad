const PAGES = {
  kalender:      { title: "Kalender",      body: calendarBody },
  lese:          { title: "Lese",          body: leseBody },
  "lese-read":   { title: "Lese",          body: leseReaderBody, parent: "lese" },
  skrive:            { title: "Skrive",   body: skriveMenuBody },
  "skrive-norsk":    { title: "Norsk",    body: skriveNorskBody,    parent: "skrive" },
  "skrive-ukrainsk": { title: "Ukrainsk", body: skriveUkrainskBody, parent: "skrive" },
  tall:          { title: "Tall",          body: tallBody },
  jobb:          { title: "Jobb",          body: jobbBody },
  innstillinger: { title: "Innstillinger", body: settingsBody },
  bakgrunn:      { title: "Bakgrunn",      body: backgroundBody, parent: "innstillinger" },
  nivaa:         { title: "Nivå",          body: nivaaBody,      parent: "innstillinger" },
};

// --- Runtime config (heading, nivaa) — fetched from /api/config, cached
// in module state, refreshed via /api/version polling. ---

let kioskConfig = { heading: "ASIPad", nivaa: "lett", gender: "female" };

function getNivaa() {
  return ["lett", "medium", "vanskelig"].includes(kioskConfig.nivaa)
    ? kioskConfig.nivaa : "lett";
}

function setNivaa(v) {
  kioskConfig.nivaa = v;
  // POST to localhost-only endpoint so the change is server-side
  // and propagates to other clients via the version poll.
  fetch("/api/nivaa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: v }),
  }).catch(() => {});
}

function applyConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return;
  const next = { ...kioskConfig, ...cfg };
  if (JSON.stringify(next) === JSON.stringify(kioskConfig)) return;
  kioskConfig = next;
  // Heading text
  const h = document.querySelector("header h1");
  if (h && h.textContent !== kioskConfig.heading) h.textContent = kioskConfig.heading;
  // If we're currently on a page that depends on config (TALL or NIVÅ),
  // re-render so the new value takes effect immediately.
  const m = location.hash.match(/^#\/(.+)/);
  const cur = m && m[1];
  if (cur === "tall" || cur === "nivaa") {
    if (PAGES[cur]) pageBody.innerHTML = PAGES[cur].body();
  }
}

function mathSumCapForNivaa() {
  const n = getNivaa();
  if (n === "vanskelig") return 100;
  if (n === "medium")    return 30;
  return 9;
}

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

// LESE: pick from up to 3 active stories, then read pages with prev/next arrows.

let activeStories = [];
let activeStory = null;
let activeStoryPage = 0;

function leseBody() {
  loadActiveStories();
  return `<div class="lese-loading">Laster…</div>`;
}

async function loadActiveStories() {
  try {
    const r = await fetch("/api/stories/active", { cache: "no-store" });
    activeStories = await r.json();
  } catch (_) {
    activeStories = [];
  }
  renderLeseLanding();
}

function renderLeseLanding() {
  if (!Array.isArray(activeStories) || activeStories.length === 0) {
    pageBody.innerHTML =
      `<div class="lese-empty">Ingen historier valgt enda. Legg til i admin.</div>`;
    return;
  }
  const cards = activeStories.map((s, i) => `
    <button class="story-card" data-action="story-open" data-story-id="${s.id}">
      <div class="story-num">${i + 1}</div>
      <div class="story-title">${escapeHtml(s.title)}</div>
      <div class="story-pages">${s.page_count} ${s.page_count === 1 ? "side" : "sider"}</div>
    </button>`).join("");
  pageBody.innerHTML = `<div class="story-list">${cards}</div>`;
}

async function openStory(id) {
  try {
    const r = await fetch(`/api/stories/${id}`, { cache: "no-store" });
    if (!r.ok) return;
    activeStory = await r.json();
    activeStoryPage = 0;
    showPage("lese-read");
  } catch (_) {}
}

function leseReaderBody() {
  if (!activeStory || !Array.isArray(activeStory.pages) || activeStory.pages.length === 0) {
    return `<div class="lese-empty">Historie mangler sider.</div>`;
  }
  const total = activeStory.pages.length;
  const idx = activeStoryPage;
  const p = activeStory.pages[idx];
  const showPrev = idx > 0;
  const showNext = idx < total - 1;
  const flipped = idx % 2 === 1; // alternate image side per page
  return `
    <div class="story-reader ${flipped ? "flipped" : ""}">
      ${showPrev
        ? `<button class="cal-nav" data-action="story-prev" aria-label="Forrige side">‹</button>`
        : `<div class="cal-nav-spacer"></div>`}
      <div class="story-page">
        <div class="story-image">
          ${p.image_url ? `<img src="${p.image_url}" alt="">` : `<div class="story-image-empty">Ingen bilde</div>`}
        </div>
        <div class="story-text">${escapeHtml(p.text || "").replace(/\n/g, "<br>")}</div>
      </div>
      ${showNext
        ? `<button class="cal-nav" data-action="story-next" aria-label="Neste side">›</button>`
        : `<div class="cal-nav-spacer"></div>`}
      <div class="story-pageno">Side ${idx + 1} av ${total}</div>
    </div>`;
}

function shiftStoryPage(delta) {
  if (!activeStory) return;
  activeStoryPage = Math.max(
    0,
    Math.min(activeStory.pages.length - 1, activeStoryPage + delta)
  );
  pageBody.innerHTML = leseReaderBody();
}

// --- TALL: simple addition game ---

let mathA = 0;
let mathB = 0;
let mathInput = "";
let mathState = "input"; // "input" | "correct" | "wrong"

function newMathProblem() {
  // Pick a, b ≥ 1 such that a + b ≤ cap. Cap is the level's "sum opp til X".
  const cap = mathSumCapForNivaa();
  mathA = 1 + Math.floor(Math.random() * (cap - 1));
  mathB = 1 + Math.floor(Math.random() * (cap - mathA));
  mathInput = "";
  mathState = "input";
}

function tallBody() {
  newMathProblem();
  return renderTall();
}

function renderTall() {
  const expected = String(mathA + mathB);
  const slots = [];
  for (let i = 0; i < expected.length; i++) {
    slots.push(`<span class="d">${mathInput[i] ?? "_"}</span>`);
  }
  const feedback =
    mathState === "correct" ? "✓ Bra!" :
    mathState === "wrong"   ? "Prøv igjen!" : "";

  const padKeys = [7, 8, 9, 4, 5, 6, 1, 2, 3];
  return `
    <div class="math-split">
      <div class="math-board ${mathState}">
        <div class="math-equation">
          <span class="m">${mathA}</span>
          <span class="op">+</span>
          <span class="m">${mathB}</span>
          <span class="op">=</span>
          <span class="answer">${slots.join("")}</span>
        </div>
        <div class="math-feedback">${feedback}</div>
      </div>
      <div class="math-pad">
        ${padKeys.map((n) =>
          `<button class="math-key" data-action="math-d" data-d="${n}">${n}</button>`
        ).join("")}
        <button class="math-key clear" data-action="math-clear">C</button>
        <button class="math-key" data-action="math-d" data-d="0">0</button>
        <button class="math-key eq" data-action="math-eq">=</button>
      </div>
    </div>`;
}

function mathDigit(d) {
  if (mathState === "correct") return;          // wait for next problem
  if (mathState === "wrong") mathState = "input";
  const maxLen = String(mathA + mathB).length;
  if (mathInput.length >= maxLen) return;
  mathInput += d;
  pageBody.innerHTML = renderTall();
}

function mathClear() {
  if (mathState === "correct") return;
  if (mathState === "wrong") mathState = "input";
  if (mathInput.length === 0) return;
  mathInput = mathInput.slice(0, -1);
  pageBody.innerHTML = renderTall();
}

function mathEquals() {
  if (mathState === "correct") return;
  const got = parseInt(mathInput || "-1", 10);
  if (got === mathA + mathB) {
    mathState = "correct";
    pageBody.innerHTML = renderTall();
    setTimeout(() => {
      newMathProblem();
      pageBody.innerHTML = renderTall();
    }, 1500);
  } else {
    mathState = "wrong";
    pageBody.innerHTML = renderTall();
  }
}

// --- SKRIVE: spell-the-word games (Norwegian + Ukrainian) ---

const SKRIVE_GAMES = {
  norsk: {
    label: "Norsk",
    flag:  "🇳🇴",
    feedback: { correct: "✓ Bra!", wrong: "Prøv igjen!" },
    kbd: [
      ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "Å"],
      ["A", "S", "D", "F", "G", "H", "J", "K", "L", "Ø", "Æ"],
      ["⌫", "Z", "X", "C", "V", "B", "N", "M", "⏎"],
    ],
    words: [
      { emoji: "🦁", word: "LØVE" },
      { emoji: "🐱", word: "KATT" },
      { emoji: "🐶", word: "HUND" },
      { emoji: "🐭", word: "MUS" },
      { emoji: "🐝", word: "BIE" },
      { emoji: "🐠", word: "FISK" },
      { emoji: "🦊", word: "REV" },
      { emoji: "🐮", word: "KU" },
      { emoji: "🐷", word: "GRIS" },
      { emoji: "🐰", word: "KANIN" },
      { emoji: "🐻", word: "BJØRN" },
      { emoji: "🐯", word: "TIGER" },
      { emoji: "🌳", word: "TRE" },
      { emoji: "☀️", word: "SOL" },
      { emoji: "🌙", word: "MÅNE" },
      { emoji: "⭐", word: "STJERNE" },
      { emoji: "🚗", word: "BIL" },
      { emoji: "✈️", word: "FLY" },
      { emoji: "🍎", word: "EPLE" },
      { emoji: "🥛", word: "MELK" },
      { emoji: "🏠", word: "HUS" },
      { emoji: "👁️", word: "ØYE" },
    ],
  },
  ukrainsk: {
    label: "Ukrainsk",
    flag:  "🇺🇦",
    feedback: { correct: "✓ Молодець!", wrong: "Спробуй ще!" },
    // ЙЦУКЕН Ukrainian layout (simplified — no Ґ, no apostrophe).
    kbd: [
      ["Й", "Ц", "У", "К", "Е", "Н", "Г", "Ш", "Щ", "З", "Х", "Ї"],
      ["Ф", "І", "В", "А", "П", "Р", "О", "Л", "Д", "Ж", "Є"],
      ["⌫", "Я", "Ч", "С", "М", "И", "Т", "Ь", "Б", "Ю", "⏎"],
    ],
    // Words intentionally chosen so the Ukrainian-easy ones don't necessarily
    // overlap with the Norwegian-easy ones (and vice versa).
    words: [
      { emoji: "🦁", word: "ЛЕВ" },
      { emoji: "🐱", word: "КІТ" },
      { emoji: "🐶", word: "ПЕС" },
      { emoji: "🐭", word: "МИША" },
      { emoji: "🐠", word: "РИБА" },
      { emoji: "🦊", word: "ЛИС" },
      { emoji: "🐯", word: "ТИГР" },
      { emoji: "🐮", word: "КОРОВА" },
      { emoji: "🐷", word: "СВИНЯ" },
      { emoji: "🐰", word: "ЗАЯЦЬ" },
      { emoji: "🐻", word: "ВЕДМІДЬ" },
      { emoji: "🐦", word: "ПТАХ" },
      { emoji: "🌳", word: "ДЕРЕВО" },
      { emoji: "☀️", word: "СОНЦЕ" },
      { emoji: "🌙", word: "МІСЯЦЬ" },
      { emoji: "⭐", word: "ЗІРКА" },
      { emoji: "🍎", word: "ЯБЛУКО" },
      { emoji: "🥛", word: "МОЛОКО" },
      { emoji: "🏠", word: "ДІМ" },
      { emoji: "👁️", word: "ОКО" },
      { emoji: "🥚", word: "ЯЙЦЕ" },
      { emoji: "🚗", word: "АВТО" },
      { emoji: "🌊", word: "МОРЕ" },
      { emoji: "🌹", word: "ТРОЯНДА" },
    ],
  },
};

let skriveMode  = "norsk";
let skriveWord  = null;
let skriveInput = "";
let skriveState = "input"; // input | correct | wrong
let skrivePrev  = null;    // last word, avoid back-to-back repeats

function skriveMenuBody() {
  return `<div class="story-list">
    <button class="story-card" data-route="skrive-norsk">
      <div class="story-flag">${SKRIVE_GAMES.norsk.flag}</div>
      <div class="story-title">${SKRIVE_GAMES.norsk.label}</div>
    </button>
    <button class="story-card" data-route="skrive-ukrainsk">
      <div class="story-flag">${SKRIVE_GAMES.ukrainsk.flag}</div>
      <div class="story-title">${SKRIVE_GAMES.ukrainsk.label}</div>
    </button>
    <div class="story-card disabled">
      <div class="story-flag">?</div>
      <div class="story-title">Kommer snart</div>
    </div>
  </div>`;
}

function skriveNorskBody() {
  skriveMode = "norsk";
  skrivePrev = null;
  newSkriveWord();
  return renderSkrive();
}

function skriveUkrainskBody() {
  skriveMode = "ukrainsk";
  skrivePrev = null;
  newSkriveWord();
  return renderSkrive();
}

function skriveCorrectFeedback() {
  // Ukrainian "great job" has separate masculine and feminine forms;
  // Norwegian "Bra!" is gender-neutral.
  if (skriveMode === "ukrainsk") {
    return kioskConfig.gender === "male" ? "✓ Молодець!" : "✓ Молодчинка!";
  }
  return SKRIVE_GAMES[skriveMode].feedback.correct;
}

function newSkriveWord() {
  const list = SKRIVE_GAMES[skriveMode].words;
  let next;
  for (let i = 0; i < 8; i++) {
    next = list[Math.floor(Math.random() * list.length)];
    if (next.word !== skrivePrev) break;
  }
  skriveWord = next;
  skrivePrev = next.word;
  skriveInput = "";
  skriveState = "input";
}

function renderSkrive() {
  const w = skriveWord.word;
  const slots = [...w].map((_, i) =>
    `<span class="d">${skriveInput[i] ?? "_"}</span>`
  ).join("");
  const feedback =
    skriveState === "correct" ? skriveCorrectFeedback() :
    skriveState === "wrong"   ? SKRIVE_GAMES[skriveMode].feedback.wrong : "";

  const layout = SKRIVE_GAMES[skriveMode].kbd;
  const kbd = layout.map((row) =>
    `<div class="osk-row">${row.map((k) =>
      `<button class="osk-key ${oskClass(k)}" data-action="skrive-k" data-k="${k}">${k}</button>`
    ).join("")}</div>`
  ).join("") +
    `<div class="osk-row">
      <button class="osk-key osk-space" data-action="skrive-k" data-k=" ">space</button>
    </div>`;

  return `
    <div class="skrive-split">
      <div class="skrive-board ${skriveState}">
        <div class="skrive-question">
          <div class="skrive-image" aria-hidden="true">${skriveWord.emoji}</div>
          <div class="skrive-word">${slots}</div>
        </div>
        <div class="skrive-feedback">${feedback}</div>
      </div>
      <div class="skrive-kbd">${kbd}</div>
    </div>`;
}

function skriveKey(k) {
  if (skriveState === "correct") return; // wait for next word
  if (k === "⌫") return skriveBackspace();
  if (k === "⏎") return skriveCheck();
  // anything else is a letter (or space) to insert
  if (skriveState === "wrong") skriveState = "input";
  if (skriveInput.length >= skriveWord.word.length) return;
  skriveInput += k;
  pageBody.innerHTML = renderSkrive();
}

function skriveBackspace() {
  if (skriveState === "correct") return;
  if (skriveState === "wrong") skriveState = "input";
  if (skriveInput.length === 0) return;
  skriveInput = skriveInput.slice(0, -1);
  pageBody.innerHTML = renderSkrive();
}

function skriveCheck() {
  if (skriveState === "correct") return;
  if (skriveInput.toUpperCase() === skriveWord.word) {
    skriveState = "correct";
    pageBody.innerHTML = renderSkrive();
    setTimeout(() => {
      newSkriveWord();
      pageBody.innerHTML = renderSkrive();
    }, 1500);
  } else {
    skriveState = "wrong";
    pageBody.innerHTML = renderSkrive();
  }
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

const SETTINGS_TILES = [
  { route: "bakgrunn", title: "Bakgrunn", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M3 17l4-4 4 4 5-5 5 5"/></svg>' },
  { route: "nivaa",    title: "Nivå",     icon: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="14" width="4" height="6" rx="0.6"/><rect x="10" y="9" width="4" height="11" rx="0.6"/><rect x="17" y="4" width="4" height="16" rx="0.6"/></svg>' },
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

// --- NIVÅ sub-page ---

const NIVAA_LEVELS = [
  { id: "lett",      label: "Lett",      desc: "Sum opp til 9",   color: "#4caf50" },
  { id: "medium",    label: "Medium",    desc: "Sum opp til 30",  color: "#ffb84d" },
  { id: "vanskelig", label: "Vanskelig", desc: "Sum opp til 100", color: "#cc4444" },
];

function nivaaBody() {
  const cur = getNivaa();
  return `<div class="nivaa-grid">
    ${NIVAA_LEVELS.map((l) => `
      <button class="nivaa-card ${l.id === cur ? "active" : ""}"
              data-action="set-nivaa" data-nivaa="${l.id}">
        <div class="nivaa-dot" style="background:${l.color}"></div>
        <div class="nivaa-name">${l.label}</div>
        <div class="nivaa-desc">${l.desc}</div>
      </button>`).join("")}
  </div>`;
}

function setActiveNivaa(v) {
  setNivaa(v);
  pageBody.innerHTML = nivaaBody();
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
  if (action === "story-open") {
    const sid = e.target.closest("[data-story-id]")?.dataset?.storyId;
    if (sid) return openStory(sid);
  }
  if (action === "story-prev") return shiftStoryPage(-1);
  if (action === "story-next") return shiftStoryPage(1);
  if (action === "math-d") {
    const d = e.target.closest("[data-d]")?.dataset?.d;
    if (d != null) return mathDigit(d);
  }
  if (action === "math-clear") return mathClear();
  if (action === "math-eq")    return mathEquals();
  if (action === "skrive-k") {
    const k = e.target.closest("[data-k]")?.dataset?.k;
    if (k) return skriveKey(k);
  }
  if (action === "set-nivaa") {
    const v = e.target.closest("[data-nivaa]")?.dataset?.nivaa;
    if (v) return setActiveNivaa(v);
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
    const { version, background, config } = await r.json();
    if (bootVersion === null) bootVersion = version;
    else if (version !== bootVersion) return location.reload();
    if (bgVersion !== background) {
      bgVersion = background;
      applyBackground(background);
    }
    if (config) applyConfig(config);
  } catch (_) { /* server may be restarting; try again */ }
}
pollVersion();
setInterval(pollVersion, 30000);
