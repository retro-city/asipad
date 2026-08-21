const PAGES = {
  kalender:             { titleKey: "page.calendar",           body: calendarBody },
  skole:                { titleKey: "page.school",             body: schoolMenuBody },
  lese:                 { titleKey: "page.read",               body: readBody,                 parent: "skole" },
  "lese-read":          { titleKey: "page.read",               body: readReaderBody,           parent: "lese" },
  skrive:               { titleKey: "page.write",              body: writeMenuBody,            parent: "skole" },
  "skrive-norsk":       { titleKey: "page.write.no",           body: writeNorwegianBody,       parent: "skrive" },
  "skrive-ukrainsk":    { titleKey: "page.write.ua",           body: writeUkrainianBody,       parent: "skrive" },
  "skrive-engelsk":     { titleKey: "page.write.en",           body: writeEnglishBody,         parent: "skrive" },
  casematch:            { titleKey: "page.school.casematch",  body: caseMatchMenuBody,        parent: "skole" },
  "skrive-storliten":   { titleKey: "page.write.casematch_no", body: () => caseMatchBody("no"), parent: "casematch" },
  "skrive-storliten-ua":{ titleKey: "page.write.casematch_ua", body: () => caseMatchBody("ua"), parent: "casematch" },
  naturfag:             { titleKey: "page.school.naturfag",   body: naturfagMenuBody,         parent: "skole" },
  "naturfag-kroppen":   { titleKey: "page.naturfag.body",     body: bodyGameBody,             parent: "naturfag" },
  "naturfag-folelser":  { titleKey: "page.naturfag.feelings", body: feelingsGameBody,         parent: "naturfag" },
  tall:                 { titleKey: "page.numbers",            body: numbersBody,              parent: "skole" },
  gange:                { titleKey: "page.multiply",           body: multiplyBody,             parent: "skole" },
  jobb:                 { titleKey: "page.work",               body: workBody },
  fritid:               { titleKey: "page.fritid",             body: fritidMenuBody },
  trening:              { titleKey: "page.fritid.training",    body: treningBody,              parent: "fritid" },
  "trening-read":       { titleKey: "page.fritid.training",    body: treningReaderBody,        parent: "trening" },
  bilder:               { titleKey: "page.fritid.pictures",    body: bilderBody,               parent: "fritid" },
  gif:                  { titleKey: "page.fritid.gif",         body: gifBody,                  parent: "fritid" },
  video:                { titleKey: "page.fritid.video",       body: videoBody,                parent: "fritid" },
  bank:                 { titleKey: "page.bank",               body: bankBody },
  innstillinger:        { titleKey: "page.settings",           body: settingsBody },
  bakgrunn:             { titleKey: "page.background",         body: backgroundBody,           parent: "innstillinger" },
  lock:                 { titleKey: "page.lock",               body: lockSettingBody,          parent: "innstillinger" },
};

// --- BANK: coin counter (rewards earned in SKOLE) ---

let coinCount = 0;

function bankBody() {
  const n = coinCount;
  const txt = n === 1 ? t("bank.singular") : t("bank.balance", { n });
  return `<div class="bank-view">
    <div class="bank-line">${n} × <span class="bank-coin" aria-hidden="true">🪙</span></div>
    <div class="bank-label">${txt}</div>
  </div>`;
}

function showCoinPopup(text, kind = "earn") {
  const popup = document.createElement("div");
  popup.className = `coin-popup coin-popup-${kind}`;
  popup.textContent = text;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 1800);
}

async function earnCoin() {
  showCoinPopup("+1 🪙", "earn");
  try {
    const r = await fetch("/api/coins/earn", { method: "POST" });
    const data = await r.json();
    if (typeof data?.count === "number") coinCount = data.count;
  } catch (_) { /* offline ok — popup already shown */ }
}

// Try to deduct N coins. Returns true on success, false on insufficient
// funds. Updates coinCount on success and triggers the -N popup.
async function spendCoins(n) {
  try {
    const r = await fetch("/api/coins/spend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n }),
    });
    const data = await r.json();
    if (!r.ok) {
      // Server reported insufficient or bad request.
      if (typeof data?.balance === "number") coinCount = data.balance;
      return false;
    }
    if (typeof data?.count === "number") coinCount = data.count;
    showCoinPopup(`-${n} 🪙`, "spend");
    return true;
  } catch (_) { return false; }
}

// --- GIF unlock state (sessionStorage; expires after GIF_UNLOCK_MS) ---
const GIF_UNLOCK_MS = 3 * 60 * 1000;

function gifUnlockMap() {
  try {
    return JSON.parse(sessionStorage.getItem("asipad_gif_unlocked") || "{}");
  } catch (_) { return {}; }
}

function saveGifUnlockMap(m) {
  try { sessionStorage.setItem("asipad_gif_unlocked", JSON.stringify(m)); } catch (_) {}
}

function isGifUnlocked(id) {
  const m = gifUnlockMap();
  return (m[id] || 0) > Date.now();
}

function setGifUnlocked(id) {
  const m = gifUnlockMap();
  m[id] = Date.now() + GIF_UNLOCK_MS;
  saveGifUnlockMap(m);
}

function fritidMenuBody() {
  // VIDEO is hidden — H.264 playback isn't viable on Pi Zero 2 W. The
  // GIF gallery replaces it for animated content; convert clips to GIF
  // on a desktop first (see README → "Converting video to GIF").
  const cards = [
    { route: "trening", icon: "🏋️", labelKey: "page.fritid.training" },
    { route: "bilder",  icon: "🖼️", labelKey: "page.fritid.pictures" },
    { route: "gif",     icon: "📽️", labelKey: "page.fritid.gif" },
    { route: null }, { route: null }, { route: null },
  ];
  return `<div class="story-list">${cards.map((c) => {
    if (!c.route) return `<div class="story-card disabled" aria-disabled="true"></div>`;
    return `<button class="story-card" data-route="${c.route}"><div class="story-flag">${c.icon}</div><div class="story-title">${t(c.labelKey)}</div></button>`;
  }).join("")}</div>`;
}

// --- TRENING: training sessions (LESE-style reader, media-aware pages) ---

let activeTrainings = [];
let activeTraining = null;
let activeTrainingPage = 0;

function treningBody() {
  loadActiveTrainings();
  return `<div class="lese-loading">${t("common.loading")}</div>`;
}

async function loadActiveTrainings() {
  try {
    const r = await fetch("/api/trainings/active", { cache: "no-store" });
    activeTrainings = await r.json();
  } catch (_) { activeTrainings = []; }
  renderTreningLanding();
}

function renderTreningLanding() {
  if (location.hash !== "#/trening") return;
  if (!Array.isArray(activeTrainings) || activeTrainings.length === 0) {
    pageBody.innerHTML = `<div class="lese-empty">${t("trening.empty")}</div>`;
    return;
  }
  const cards = activeTrainings.map((s, i) => `
    <button class="story-card" data-action="trening-open" data-trening-id="${s.id}">
      <div class="story-num">${i + 1}</div>
      <div class="story-title">${escapeHtml(s.title)}</div>
      <div class="story-pages">${s.page_count} ${s.page_count === 1 ? t("read.page_label_singular") : t("read.page_label_plural")}</div>
    </button>`).join("");
  pageBody.innerHTML = `<div class="story-list">${cards}</div>`;
}

async function openTrening(id) {
  try {
    const r = await fetch(`/api/trainings/${id}`, { cache: "no-store" });
    if (!r.ok) return;
    activeTraining = await r.json();
    activeTrainingPage = 0;
    showPage("trening-read");
  } catch (_) {}
}

function treningReaderBody() {
  if (!activeTraining || !Array.isArray(activeTraining.pages) || activeTraining.pages.length === 0) {
    return `<div class="lese-empty">${t("read.no_pages")}</div>`;
  }
  const total = activeTraining.pages.length;
  const idx = activeTrainingPage;
  const p = activeTraining.pages[idx];
  const showPrev = idx > 0;
  const showNext = idx < total - 1;
  const flipped = idx % 2 === 1;

  let mediaHtml;
  if (p.media_kind === "video") {
    const poster = p.poster_url ? ` poster="${p.poster_url}"` : "";
    mediaHtml = `<video class="story-media" src="${p.media_url}"${poster} controls autoplay playsinline muted loop></video>`;
  } else if (p.media_url) {
    mediaHtml = `<img class="story-media" src="${p.media_url}" alt="">`;
  } else {
    mediaHtml = `<div class="story-image-empty">${t("read.no_image")}</div>`;
  }

  return `
    <div class="story-reader ${flipped ? "flipped" : ""}">
      ${showPrev
        ? `<button class="cal-nav" data-action="trening-prev" aria-label="${t("read.prev_aria")}">‹</button>`
        : `<div class="cal-nav-spacer"></div>`}
      <div class="story-page">
        <div class="story-image">${mediaHtml}</div>
        <div class="story-text">${escapeHtml(p.text || "").replace(/\n/g, "<br>")}</div>
      </div>
      ${showNext
        ? `<button class="cal-nav" data-action="trening-next" aria-label="${t("read.next_aria")}">›</button>`
        : `<div class="cal-nav-spacer"></div>`}
      <div class="story-pageno">${t("read.page_of", { idx: idx + 1, total })}</div>
    </div>`;
}

function shiftTreningPage(delta) {
  if (!activeTraining) return;
  activeTrainingPage = Math.max(0, Math.min(activeTraining.pages.length - 1, activeTrainingPage + delta));
  pageBody.innerHTML = treningReaderBody();
}

// --- LEI FILM: paid rental gallery (paged → fullscreen overlay) ---
// Accepts animated GIF/WebP (rendered via <img>) AND mp4/webm/mov/m4v
// (rendered via <video>). The route stays "gif" for backward compat.
// Mirrors BILDER pagination + overlay. Cost/unlock mechanics apply
// to both kinds the same way.

const GIF_PAGE_SIZE = 6;
let gifItems = [];
let gifPage = 0;

function gifBody() {
  gifPage = 0;
  loadGifs();
  return `<div class="lese-loading">${t("common.loading")}</div>`;
}

async function loadGifs() {
  try {
    const r = await fetch("/api/gifs", { cache: "no-store" });
    gifItems = await r.json();
  } catch (_) { gifItems = []; }
  renderGifPage();
}

function renderGifPage() {
  if (location.hash !== "#/gif") return;
  if (!Array.isArray(gifItems) || gifItems.length === 0) {
    pageBody.innerHTML = `<div class="lese-empty">${t("gif.empty")}</div>`;
    return;
  }
  const total = gifItems.length;
  const totalPages = Math.max(1, Math.ceil(total / GIF_PAGE_SIZE));
  gifPage = Math.max(0, Math.min(gifPage, totalPages - 1));
  const start = gifPage * GIF_PAGE_SIZE;
  const items = gifItems.slice(start, start + GIF_PAGE_SIZE);
  const cells = [];
  for (let i = 0; i < GIF_PAGE_SIZE; i++) {
    const g = items[i];
    if (g) {
      // Use the static first-frame poster on the tile so the gallery
      // doesn't run six simultaneous animations. Full-screen view
      // (openGif) still loads the live source. For videos without a
      // poster (ffmpeg unavailable), fall back to <video preload=
      // "metadata"> which lets WebKit render a single frame cheaply.
      const cost = Number(g.cost ?? 0);
      const unlocked = isGifUnlocked(g.id);
      const showPrice = cost > 0 && !unlocked;
      const tileClass = showPrice ? "bg-tile rental-locked" : "bg-tile";
      const overlay = showPrice
        ? `<div class="rental-price">${cost} 🪙</div>`
        : (cost > 0 && unlocked ? `<div class="rental-unlocked">✓</div>` : "");
      const media = g.poster_url
        ? `<img src="${g.poster_url}" alt="">`
        : g.kind === "video"
          ? `<video src="${g.url}#t=0.5" preload="metadata" muted playsinline></video>`
          : `<img src="${g.url}" alt="">`;
      cells.push(`<button class="${tileClass}" data-action="gif-open" data-gif-id="${g.id}">${media}${overlay}</button>`);
    } else {
      cells.push(`<div class="bg-tile empty"></div>`);
    }
  }
  const showArrows = totalPages > 1;
  pageBody.innerHTML = `
    <div class="bg-pager">
      ${showArrows
        ? `<button class="cal-nav" data-action="gif-prev" ${gifPage === 0 ? "disabled" : ""}>‹</button>`
        : `<div class="cal-nav-spacer"></div>`}
      <div class="bg-grid">${cells.join("")}</div>
      ${showArrows
        ? `<button class="cal-nav" data-action="gif-next" ${gifPage >= totalPages - 1 ? "disabled" : ""}>›</button>`
        : `<div class="cal-nav-spacer"></div>`}
    </div>`;
}

async function openGif(id) {
  const item = gifItems.find((g) => g.id === id);
  if (!item) return;
  const cost = Number(item.cost ?? 0);
  // Pay-and-unlock: costless or already-rented items open straight away.
  if (cost > 0 && !isGifUnlocked(id)) {
    if (coinCount < cost) {
      showInsufficientFunds();
      return;
    }
    const ok = await spendCoins(cost);
    if (!ok) {
      showInsufficientFunds();
      return;
    }
    setGifUnlocked(id);
    renderGifPage(); // refresh price overlay → ✓ unlocked indicator
  }
  const overlay = document.createElement("div");
  overlay.className = "bilder-overlay";
  // Free rentals (cost === 0) stay open until the user dismisses; paid
  // rentals get an MM:SS countdown that auto-closes when it hits 0.
  const showTimer = cost > 0;
  const poster = item.poster_url ? ` poster="${item.poster_url}"` : "";
  const media = item.kind === "video"
    ? `<video class="bilder-full" src="${item.url}"${poster} autoplay controls playsinline loop></video>`
    : `<img class="bilder-full" src="${item.url}" alt="">`;
  overlay.innerHTML = `${media}
    ${showTimer ? `<div class="rental-timer">--:--</div>` : ""}
    <button class="bilder-close" type="button" aria-label="Close">×</button>`;
  // Tap-anywhere-to-close on images; on videos, only the X closes (so
  // taps on the playback bar / video surface don't dismiss the rental).
  if (item.kind === "video") {
    overlay.querySelector(".bilder-close").addEventListener("pointerup", () => {
      overlay.querySelector("video")?.pause();
      overlay.remove();
    });
  } else {
    overlay.addEventListener("pointerup", () => overlay.remove());
  }
  document.body.appendChild(overlay);

  if (showTimer) {
    const timerEl = overlay.querySelector(".rental-timer");
    let interval;
    const tick = () => {
      if (!document.body.contains(overlay)) { clearInterval(interval); return; }
      const remaining = (gifUnlockMap()[id] || 0) - Date.now();
      if (remaining <= 0) {
        clearInterval(interval);
        overlay.remove();
        renderGifPage();
        return;
      }
      const total = Math.ceil(remaining / 1000);
      const mm = String(Math.floor(total / 60)).padStart(2, "0");
      const ss = String(total % 60).padStart(2, "0");
      timerEl.textContent = `${mm}:${ss}`;
    };
    tick();
    interval = setInterval(tick, 1000);
  }
}

function showInsufficientFunds() {
  const popup = document.createElement("div");
  popup.className = "coin-popup coin-popup-deny";
  popup.textContent = t("rent.insufficient");
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 1800);
}

// --- VIDEO: video gallery (paged → fullscreen overlay with controls) ---

const VIDEO_PAGE_SIZE = 6;
let videoItems = [];
let videoPage = 0;

function videoBody() {
  videoPage = 0;
  loadVideos();
  return `<div class="lese-loading">${t("common.loading")}</div>`;
}

async function loadVideos() {
  try {
    const r = await fetch("/api/videos", { cache: "no-store" });
    videoItems = await r.json();
  } catch (_) { videoItems = []; }
  renderVideoPage();
}

function renderVideoPage() {
  if (location.hash !== "#/video") return;
  if (!Array.isArray(videoItems) || videoItems.length === 0) {
    pageBody.innerHTML = `<div class="lese-empty">${t("video.empty")}</div>`;
    return;
  }
  const total = videoItems.length;
  const totalPages = Math.max(1, Math.ceil(total / VIDEO_PAGE_SIZE));
  videoPage = Math.max(0, Math.min(videoPage, totalPages - 1));
  const start = videoPage * VIDEO_PAGE_SIZE;
  const items = videoItems.slice(start, start + VIDEO_PAGE_SIZE);
  const cells = [];
  for (let i = 0; i < VIDEO_PAGE_SIZE; i++) {
    const v = items[i];
    if (v) {
      const thumb = v.poster_url
        ? `<img src="${v.poster_url}" alt="">`
        : `<video src="${v.url}#t=0.5" preload="metadata" muted playsinline></video>`;
      cells.push(`
        <button class="bg-tile video-tile" data-action="video-open" data-video-id="${v.id}">
          ${thumb}
          <div class="video-play" aria-hidden="true">▶</div>
        </button>`);
    } else {
      cells.push(`<div class="bg-tile empty"></div>`);
    }
  }
  const showArrows = totalPages > 1;
  pageBody.innerHTML = `
    <div class="bg-pager">
      ${showArrows
        ? `<button class="cal-nav" data-action="video-prev" ${videoPage === 0 ? "disabled" : ""}>‹</button>`
        : `<div class="cal-nav-spacer"></div>`}
      <div class="bg-grid">${cells.join("")}</div>
      ${showArrows
        ? `<button class="cal-nav" data-action="video-next" ${videoPage >= totalPages - 1 ? "disabled" : ""}>›</button>`
        : `<div class="cal-nav-spacer"></div>`}
    </div>`;
}

function openVideo(id) {
  const item = videoItems.find((v) => v.id === id);
  if (!item) return;
  const overlay = document.createElement("div");
  overlay.className = "bilder-overlay video-overlay";
  const poster = item.poster_url ? ` poster="${item.poster_url}"` : "";
  overlay.innerHTML = `<video class="bilder-full" src="${item.url}"${poster} controls autoplay playsinline></video>
    <button class="bilder-close" type="button" aria-label="Close">×</button>`;
  // Close only on the X — clicks on the video itself shouldn't dismiss
  // (otherwise scrubbing or pause-tap closes the player).
  overlay.querySelector(".bilder-close").addEventListener("pointerup", () => {
    overlay.querySelector("video")?.pause();
    overlay.remove();
  });
  document.body.appendChild(overlay);
}

// --- BILDER: picture gallery (paged grid → fullscreen overlay) ---

const BILDER_PAGE_SIZE = 6;
let bilderItems = [];
let bilderPage = 0;

function bilderBody() {
  bilderPage = 0;
  loadPictures();
  return `<div class="lese-loading">${t("common.loading")}</div>`;
}

async function loadPictures() {
  try {
    const r = await fetch("/api/pictures", { cache: "no-store" });
    bilderItems = await r.json();
  } catch (_) {
    bilderItems = [];
  }
  renderBilderPage();
}

function renderBilderPage() {
  if (location.hash !== "#/bilder") return;
  if (!Array.isArray(bilderItems) || bilderItems.length === 0) {
    pageBody.innerHTML = `<div class="lese-empty">${t("bilder.empty")}</div>`;
    return;
  }
  const total = bilderItems.length;
  const totalPages = Math.max(1, Math.ceil(total / BILDER_PAGE_SIZE));
  bilderPage = Math.max(0, Math.min(bilderPage, totalPages - 1));
  const start = bilderPage * BILDER_PAGE_SIZE;
  const items = bilderItems.slice(start, start + BILDER_PAGE_SIZE);
  const cells = [];
  for (let i = 0; i < BILDER_PAGE_SIZE; i++) {
    const p = items[i];
    if (p) {
      cells.push(`<button class="bg-tile" data-action="bilder-open" data-bilder-id="${p.id}"><img src="${p.url}" alt=""></button>`);
    } else {
      cells.push(`<div class="bg-tile empty"></div>`);
    }
  }
  const showArrows = totalPages > 1;
  pageBody.innerHTML = `
    <div class="bg-pager">
      ${showArrows
        ? `<button class="cal-nav" data-action="bilder-prev" ${bilderPage === 0 ? "disabled" : ""}>‹</button>`
        : `<div class="cal-nav-spacer"></div>`}
      <div class="bg-grid">${cells.join("")}</div>
      ${showArrows
        ? `<button class="cal-nav" data-action="bilder-next" ${bilderPage >= totalPages - 1 ? "disabled" : ""}>›</button>`
        : `<div class="cal-nav-spacer"></div>`}
    </div>`;
}

function openBilder(id) {
  const item = bilderItems.find((b) => b.id === id);
  if (!item) return;
  const overlay = document.createElement("div");
  overlay.className = "bilder-overlay";
  overlay.innerHTML = `<img class="bilder-full" src="${item.url}" alt="">
    <button class="bilder-close" type="button" aria-label="Close">×</button>`;
  overlay.addEventListener("pointerup", () => overlay.remove());
  document.body.appendChild(overlay);
}

function schoolMenuBody() {
  const cards = [
    { route: "lese",      icon: "📖", labelKey: "page.read" },
    { route: "skrive",    icon: "✏️", labelKey: "page.write" },
    { route: "tall",      icon: "➕", labelKey: "page.numbers" },
    { route: "casematch", icon: "🔡", labelKey: "page.school.casematch" },
    { route: "naturfag",  icon: "🔬", labelKey: "page.school.naturfag" },
    { route: "gange",     icon: "✖️", labelKey: "page.multiply" },
  ];
  return `<div class="story-list">${cards.map((c) => {
    const label = t(c.labelKey);
    return c.route
      ? `<button class="story-card" data-route="${c.route}"><div class="story-flag">${c.icon}</div><div class="story-title">${label}</div></button>`
      : `<div class="story-card disabled" aria-disabled="true"></div>`;
  }).join("")}</div>`;
}

function caseMatchMenuBody() {
  // Two-flag picker: pick alphabet, then play. Mirrors SKRIVE's language menu.
  const cards = [
    { route: "skrive-storliten",    flag: "🇳🇴", labelKey: "page.write.no" },
    { route: "skrive-storliten-ua", flag: "🇺🇦", labelKey: "page.write.ua" },
  ];
  return `<div class="story-list">${cards.map((c) =>
    `<button class="story-card" data-route="${c.route}"><div class="story-flag">${c.flag}</div><div class="story-title">${t(c.labelKey)}</div></button>`
  ).join("")}</div>`;
}

// --- NATURFAG: KROPPEN + FØLELSER (tap-the-right-thing games) -----
// Two parallel mechanics from feature-sketches/{spill om kroppen, følelser}.
// Show all items in a grid, prompt "Trykk på X", tap the matching tile.
// Correct → green tile + 🪙 + next round; wrong → red flash, retry.

const NATURFAG_BODY_PARTS = [
  { id: "hjerte", emoji: "🫀", labelKey: "naturfag.body.heart" },
  { id: "hjerne", emoji: "🧠", labelKey: "naturfag.body.brain" },
  { id: "tarm",   image: "/assets/intestine.svg", labelKey: "naturfag.body.intestine" },
  { id: "lunge",  emoji: "🫁", labelKey: "naturfag.body.lung" },
  { id: "oye",    emoji: "👁️", labelKey: "naturfag.body.eye" },
  { id: "ore",    emoji: "👂", labelKey: "naturfag.body.ear" },
  { id: "nese",   emoji: "👃", labelKey: "naturfag.body.nose" },
  { id: "munn",   emoji: "👄", labelKey: "naturfag.body.mouth" },
  { id: "hand",   emoji: "✋", labelKey: "naturfag.body.hand" },
  { id: "fot",    emoji: "🦶", labelKey: "naturfag.body.foot" },
  { id: "tunge",   emoji: "👅", labelKey: "naturfag.body.tongue" },
  { id: "tann",    emoji: "🦷", labelKey: "naturfag.body.tooth" },
  { id: "skjelett",emoji: "🦴", labelKey: "naturfag.body.skeleton" },
  { id: "muskel",  emoji: "💪", labelKey: "naturfag.body.muscle" },
  { id: "finger",  emoji: "👆", labelKey: "naturfag.body.finger" },
  { id: "blod",    emoji: "🩸", labelKey: "naturfag.body.blood" },
  { id: "ben",     emoji: "🦵", labelKey: "naturfag.body.leg" },
  { id: "dna",     emoji: "🧬", labelKey: "naturfag.body.dna" },
];

const NATURFAG_FEELINGS = [
  { id: "glad",       emoji: "😊", labelKey: "naturfag.feel.happy" },
  { id: "trist",      emoji: "😢", labelKey: "naturfag.feel.sad" },
  { id: "sint",       emoji: "😠", labelKey: "naturfag.feel.angry" },
  { id: "redd",       emoji: "😨", labelKey: "naturfag.feel.afraid" },
  { id: "overrasket", emoji: "😮", labelKey: "naturfag.feel.surprised" },
  { id: "trott",      emoji: "😴", labelKey: "naturfag.feel.tired" },
  { id: "forelsket",  emoji: "😍", labelKey: "naturfag.feel.in_love" },
  { id: "syk",        emoji: "🤒", labelKey: "naturfag.feel.sick" },
  { id: "lattermild", emoji: "😂", labelKey: "naturfag.feel.laughing" },
  { id: "rolig",      emoji: "😌", labelKey: "naturfag.feel.calm" },
  { id: "flau",        emoji: "😳", labelKey: "naturfag.feel.embarrassed" },
  { id: "stolt",       emoji: "🥹", labelKey: "naturfag.feel.proud" },
  { id: "bekymret",    emoji: "😟", labelKey: "naturfag.feel.worried" },
  { id: "nervos",      emoji: "😬", labelKey: "naturfag.feel.nervous" },
  { id: "forvirret",   emoji: "😕", labelKey: "naturfag.feel.confused" },
  { id: "kjedet",      emoji: "😒", labelKey: "naturfag.feel.bored" },
  { id: "takknemlig",  emoji: "🙏", labelKey: "naturfag.feel.grateful" },
  { id: "modig",       emoji: "😤", labelKey: "naturfag.feel.brave" },
  { id: "frisk",       emoji: "💃", labelKey: "naturfag.feel.energetic" },
  { id: "fornoyd",     emoji: "🙂", labelKey: "naturfag.feel.content" },
];

const NATURFAG_DISPLAY_COUNT = 6; // tiles per round (incl. the target)

let tapGame = null;

function naturfagMenuBody() {
  const cards = [
    { route: "naturfag-kroppen",  icon: "🫀", labelKey: "page.naturfag.body" },
    { route: "naturfag-folelser", icon: "😊", labelKey: "page.naturfag.feelings" },
  ];
  return `<div class="story-list">${cards.map((c) =>
    `<button class="story-card" data-route="${c.route}"><div class="story-flag">${c.icon}</div><div class="story-title">${t(c.labelKey)}</div></button>`
  ).join("")}</div>`;
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sampleRound(pool, target) {
  // Always include the target; fill the rest with distinct distractors
  // from the pool. With small pools this just returns the whole pool.
  const distractors = pool.filter((x) => x.id !== target.id);
  const need = Math.min(NATURFAG_DISPLAY_COUNT - 1, distractors.length);
  const picked = shuffleArray(distractors).slice(0, need);
  return shuffleArray([...picked, target]);
}

function startTapGame(items) {
  const target = items[Math.floor(Math.random() * items.length)];
  tapGame = {
    pool: items,
    layout: sampleRound(items, target),
    target,
    state: "input",   // "input" | "correct" | "wrong"
    wrongId: null,
  };
}

function nextTapRound() {
  if (!tapGame) return;
  const { pool, target: prev } = tapGame;
  let next = prev;
  for (let i = 0; i < 8 && next.id === prev.id; i++) {
    next = pool[Math.floor(Math.random() * pool.length)];
  }
  tapGame.target = next;
  tapGame.layout = sampleRound(pool, next);
  tapGame.state = "input";
  tapGame.wrongId = null;
}

function renderTapGame() {
  if (!tapGame) return "";
  const { layout, target, state, wrongId } = tapGame;
  const cols = layout.length <= 4 ? 2 : 3;
  const cells = layout.map((it) => {
    const cls = ["tap-tile",
      state === "correct" && it.id === target.id ? "correct" : "",
      wrongId === it.id ? "wrong" : "",
    ].filter(Boolean).join(" ");
    const visual = it.image
      ? `<img class="tap-emoji tap-img" src="${it.image}" alt="">`
      : `<div class="tap-emoji">${it.emoji}</div>`;
    return `<button class="${cls}" data-action="tap-pick" data-id="${it.id}">
      ${visual}
      <div class="tap-label">${t(it.labelKey)}</div>
    </button>`;
  }).join("");
  const feedback =
    state === "correct" ? t("common.good_job") :
    state === "wrong"   ? t("common.try_again") : "";
  return `
    <div class="tap-game">
      <div class="tap-prompt">${t("naturfag.tap_prompt", { what: t(target.labelKey) })}</div>
      <div class="tap-grid cols-${cols}">${cells}</div>
      <div class="tap-feedback ${state}">${feedback}</div>
    </div>`;
}

function bodyGameBody() {
  startTapGame(NATURFAG_BODY_PARTS);
  return renderTapGame();
}

function feelingsGameBody() {
  startTapGame(NATURFAG_FEELINGS);
  return renderTapGame();
}

function tapPick(id) {
  if (!tapGame || tapGame.state === "correct") return;
  if (id === tapGame.target.id) {
    tapGame.state = "correct";
    pageBody.innerHTML = renderTapGame();
    earnCoin();
    setTimeout(() => {
      nextTapRound();
      pageBody.innerHTML = renderTapGame();
    }, 1500);
  } else {
    tapGame.state = "wrong";
    tapGame.wrongId = id;
    pageBody.innerHTML = renderTapGame();
    setTimeout(() => {
      if (!tapGame || tapGame.state !== "wrong") return;
      tapGame.state = "input";
      tapGame.wrongId = null;
      pageBody.innerHTML = renderTapGame();
    }, 900);
  }
}

// --- Runtime config (heading, level, lang, gender) — fetched from
// /api/config, cached in module state, refreshed via /api/version polling. ---

let kioskConfig = {
  heading: "ASIPad",
  level: "easy",
  gender: "female",
  kiosk_lang: "no",
  show_logo: true,
  show_heading: true,
  lock_pattern: [],
  time_budget_minutes: 15,
  time_extension_pattern: ["red", "green", "blue", "blue", "green", "red"],
  time_extension_options: [10, 15, 20],
};

function getLevel() {
  return ["easy", "medium", "hard"].includes(kioskConfig.level)
    ? kioskConfig.level : "easy";
}

function applyConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return;
  const next = { ...kioskConfig, ...cfg };
  if (JSON.stringify(next) === JSON.stringify(kioskConfig)) return;
  const langChanged = next.kiosk_lang !== kioskConfig.kiosk_lang;
  kioskConfig = next;
  const h = document.querySelector("header h1");
  if (h && h.textContent !== kioskConfig.heading) h.textContent = kioskConfig.heading;
  // Toggle the home-screen logo + heading visibility from admin config.
  const logo = document.querySelector(".header-logo");
  if (logo) logo.style.display = kioskConfig.show_logo === false ? "none" : "";
  if (h) h.style.display = kioskConfig.show_heading === false ? "none" : "";
  // Padlock visibility: only show the trigger when a 3-colour password
  // is configured. The overlay itself is rendered/dismissed elsewhere.
  if (typeof updateLockTriggerVisibility === "function") updateLockTriggerVisibility();
  // Re-evaluate the activity timer in case admin enabled/disabled it or
  // changed the budget — but don't reset existing remaining time.
  if (typeof syncTimerForRoute === "function") syncTimerForRoute();
  if (langChanged && typeof setLocale === "function") {
    setLocale(kioskConfig.kiosk_lang).then(() => rerenderForLocale());
    return;
  }
  // If TALL is open, re-render so the level change takes effect immediately.
  const m = location.hash.match(/^#\/(.+)/);
  const cur = m && m[1];
  if (cur === "tall" && PAGES[cur]) pageBody.innerHTML = PAGES[cur].body();
}

function rerenderForLocale() {
  if (typeof applyTranslations === "function") applyTranslations();
  const m = location.hash.match(/^#\/(.+)/);
  const cur = m && m[1];
  if (cur && PAGES[cur]) {
    pageTitle.textContent = PAGES[cur].titleKey ? t(PAGES[cur].titleKey) : (PAGES[cur].title || "");
    pageBody.innerHTML = PAGES[cur].body();
  }
}

function mathSumCapForLevel() {
  const n = getLevel();
  if (n === "hard") return 100;
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

function readBody() {
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
  renderReadLanding();
}

function renderReadLanding() {
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

function readReaderBody() {
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
  pageBody.innerHTML = readReaderBody();
}

// --- PLUSS / GANGE: simple arithmetic games (addition + multiplication) ---

let mathA = 0;
let mathB = 0;
let mathInput = "";
let mathState = "input"; // "input" | "correct" | "wrong"
let mathOp = "plus";     // "plus" | "multiply"

function mathExpected() {
  return mathOp === "multiply" ? mathA * mathB : mathA + mathB;
}

function mathOpSymbol() {
  return mathOp === "multiply" ? "·" : "+";
}

function newMathProblem() {
  // Cap is the level's "sum opp til X" (9 / 30 / 100). Pluss keeps the sum
  // ≤ cap; gange keeps the product ≤ cap so the same difficulty knob applies.
  const cap = mathSumCapForLevel();
  if (mathOp === "multiply") {
    // Cap the product at the level's sum-cap, AND keep individual factors
    // ≤ 10 whenever cap ≤ 100 — kids learn the standard 10×10 times table,
    // not awkward 12·8 = 96 style problems.
    const factorMax = cap <= 100 ? 10 : Math.floor(Math.sqrt(cap)) + 2;
    const aMax = Math.min(factorMax, cap);
    mathA = 1 + Math.floor(Math.random() * aMax);
    const bMax = Math.min(factorMax, Math.max(1, Math.floor(cap / mathA)));
    mathB = 1 + Math.floor(Math.random() * bMax);
  } else {
    mathA = 1 + Math.floor(Math.random() * (cap - 1));
    mathB = 1 + Math.floor(Math.random() * (cap - mathA));
  }
  mathInput = "";
  mathState = "input";
}

function numbersBody() {
  mathOp = "plus";
  newMathProblem();
  return renderMath();
}

function multiplyBody() {
  mathOp = "multiply";
  newMathProblem();
  return renderMath();
}

function renderMath() {
  const expected = String(mathExpected());
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
          <span class="op">${mathOpSymbol()}</span>
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
  if (mathState === "correct") return;
  if (mathState === "wrong") mathState = "input";
  const maxLen = String(mathExpected()).length;
  if (mathInput.length >= maxLen) return;
  mathInput += d;
  pageBody.innerHTML = renderMath();
}

function mathClear() {
  if (mathState === "correct") return;
  if (mathState === "wrong") mathState = "input";
  if (mathInput.length === 0) return;
  mathInput = mathInput.slice(0, -1);
  pageBody.innerHTML = renderMath();
}

function mathEquals() {
  if (mathState === "correct") return;
  const got = parseInt(mathInput || "-1", 10);
  if (got === mathExpected()) {
    mathState = "correct";
    pageBody.innerHTML = renderMath();
    earnCoin();
    setTimeout(() => {
      newMathProblem();
      pageBody.innerHTML = renderMath();
    }, 1500);
  } else {
    mathState = "wrong";
    pageBody.innerHTML = renderMath();
  }
}

// --- SKRIVE: spell-the-word games (Norwegian + Ukrainian) ---

const WRITE_LANGS = {
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
      { emoji: "🐺", word: "ULV" },
      { emoji: "🦉", word: "UGLE" },
      { emoji: "🐧", word: "PINGVIN" },
      { emoji: "🐘", word: "ELEFANT" },
      { emoji: "🦒", word: "SJIRAFF" },
      { emoji: "🐢", word: "SKILPADDE" },
      { emoji: "🐳", word: "HVAL" },
      { emoji: "🦭", word: "SEL" },
      { emoji: "🦀", word: "KRABBE" },
      { emoji: "🐔", word: "HØNE" },
      { emoji: "🦆", word: "AND" },
      { emoji: "🦅", word: "ØRN" },
      { emoji: "🐵", word: "APE" },
      { emoji: "🐸", word: "FROSK" },
      { emoji: "🪰", word: "FLUE" },
      { emoji: "🤖", word: "ROBOT" },
      { emoji: "❤️", word: "HJERTE" },
      { emoji: "🌳", word: "TRE" },
      { emoji: "☀️", word: "SOL" },
      { emoji: "🌙", word: "MÅNE" },
      { emoji: "⭐", word: "STJERNE" },
      { emoji: "🌈", word: "REGNBUE" },
      { emoji: "❄️", word: "SNØ" },
      { emoji: "☁️", word: "SKY" },
      { emoji: "🌹", word: "ROSE" },
      { emoji: "🚗", word: "BIL" },
      { emoji: "✈️", word: "FLY" },
      { emoji: "🚲", word: "SYKKEL" },
      { emoji: "🚂", word: "TOG" },
      { emoji: "🚢", word: "BÅT" },
      { emoji: "🍎", word: "EPLE" },
      { emoji: "🍌", word: "BANAN" },
      { emoji: "🥕", word: "GULROT" },
      { emoji: "🍅", word: "TOMAT" },
      { emoji: "🥒", word: "AGURK" },
      { emoji: "🧅", word: "LØK" },
      { emoji: "🥚", word: "EGG" },
      { emoji: "🍞", word: "BRØD" },
      { emoji: "🍕", word: "PIZZA" },
      { emoji: "🍰", word: "KAKE" },
      { emoji: "🍦", word: "IS" },
      { emoji: "🥛", word: "MELK" },
      { emoji: "🍵", word: "TE" },
      { emoji: "☕", word: "KAFFE" },
      { emoji: "⚽", word: "BALL" },
      { emoji: "🏠", word: "HUS" },
      { emoji: "🚓", word: "POLITI" },
      { emoji: "👶", word: "BABY" },
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
  engelsk: {
    label: "Engelsk",
    flag:  "🇬🇧",
    feedback: { correct: "✓ Good job!", wrong: "Try again!" },
    kbd: [
      ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
      ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
      ["⌫", "Z", "X", "C", "V", "B", "N", "M", "⏎"],
    ],
    // English mirrors of the Norwegian list (same emoji, English word).
    words: [
      { emoji: "🦁", word: "LION" },
      { emoji: "🐱", word: "CAT" },
      { emoji: "🐶", word: "DOG" },
      { emoji: "🐭", word: "MOUSE" },
      { emoji: "🐝", word: "BEE" },
      { emoji: "🐠", word: "FISH" },
      { emoji: "🦊", word: "FOX" },
      { emoji: "🐮", word: "COW" },
      { emoji: "🐷", word: "PIG" },
      { emoji: "🐰", word: "RABBIT" },
      { emoji: "🐻", word: "BEAR" },
      { emoji: "🐯", word: "TIGER" },
      { emoji: "🐺", word: "WOLF" },
      { emoji: "🦉", word: "OWL" },
      { emoji: "🐧", word: "PENGUIN" },
      { emoji: "🐘", word: "ELEPHANT", minLevel: "medium" },
      { emoji: "🦒", word: "GIRAFFE" },
      { emoji: "🐢", word: "TURTLE" },
      { emoji: "🐳", word: "WHALE" },
      { emoji: "🦭", word: "SEAL" },
      { emoji: "🦀", word: "CRAB" },
      { emoji: "🐔", word: "HEN" },
      { emoji: "🦆", word: "DUCK" },
      { emoji: "🦅", word: "EAGLE" },
      { emoji: "🐵", word: "MONKEY" },
      { emoji: "🐸", word: "FROG" },
      { emoji: "🪰", word: "FLY" },
      { emoji: "🤖", word: "ROBOT" },
      { emoji: "❤️", word: "HEART" },
      { emoji: "🌳", word: "TREE" },
      { emoji: "☀️", word: "SUN" },
      { emoji: "🌙", word: "MOON" },
      { emoji: "⭐", word: "STAR" },
      { emoji: "🌈", word: "RAINBOW" },
      { emoji: "❄️", word: "SNOW" },
      { emoji: "☁️", word: "CLOUD" },
      { emoji: "🌹", word: "ROSE" },
      { emoji: "🚗", word: "CAR" },
      { emoji: "✈️", word: "PLANE" },
      { emoji: "🚲", word: "BIKE" },
      { emoji: "🚂", word: "TRAIN" },
      { emoji: "🚢", word: "BOAT" },
      { emoji: "🍎", word: "APPLE" },
      { emoji: "🍌", word: "BANANA" },
      { emoji: "🥕", word: "CARROT" },
      { emoji: "🍅", word: "TOMATO" },
      { emoji: "🥒", word: "CUCUMBER" },
      { emoji: "🧅", word: "ONION" },
      { emoji: "🥚", word: "EGG" },
      { emoji: "🍞", word: "BREAD" },
      { emoji: "🍕", word: "PIZZA" },
      { emoji: "🍰", word: "CAKE" },
      { emoji: "🍦", word: "ICECREAM" },
      { emoji: "🥛", word: "MILK" },
      { emoji: "🍵", word: "TEA" },
      { emoji: "☕", word: "COFFEE" },
      { emoji: "⚽", word: "BALL" },
      { emoji: "🏠", word: "HOUSE" },
      { emoji: "🚓", word: "POLICE" },
      { emoji: "👶", word: "BABY" },
      { emoji: "👁️", word: "EYE" },
    ],
  },
};

let writeMode  = "norsk";
let writeWord  = null;
let writeInput = "";
let writeState = "input"; // input | correct | wrong
let writePrev  = null;    // last word, avoid back-to-back repeats

function writeMenuBody() {
  const cards = [
    { route: "skrive-norsk",    flag: WRITE_LANGS.norsk.flag,    labelKey: "page.write.no" },
    { route: "skrive-ukrainsk", flag: WRITE_LANGS.ukrainsk.flag, labelKey: "page.write.ua" },
    { route: "skrive-engelsk",  flag: WRITE_LANGS.engelsk.flag,  labelKey: "page.write.en" },
    { route: null,              flag: "✨",                        labelKey: "common.coming_soon" },
    { route: null,              flag: "✨",                        labelKey: "common.coming_soon" },
    { route: null,              flag: "✨",                        labelKey: "common.coming_soon" },
  ];
  return `<div class="story-list">${cards.map((c) => {
    const label = t(c.labelKey);
    return c.route
      ? `<button class="story-card" data-route="${c.route}"><div class="story-flag">${c.flag}</div><div class="story-title">${label}</div></button>`
      : `<div class="story-card disabled" aria-disabled="true"></div>`;
  }).join("")}</div>`;
}

function writeNorwegianBody() {
  writeMode = "norsk";
  writePrev = null;
  newWriteWord();
  return renderWrite();
}

function writeUkrainianBody() {
  writeMode = "ukrainsk";
  writePrev = null;
  newWriteWord();
  return renderWrite();
}

function writeEnglishBody() {
  writeMode = "engelsk";
  writePrev = null;
  newWriteWord();
  return renderWrite();
}

// --- Stor og liten — capital/lowercase letter matcher ---
const CASE_MATCH_ALPHABETS = {
  no: "abcdefghijklmnopqrstuvwxyzæøå",
  ua: "абвгґдеєжзиіїйклмнопрстуфхцчшщьюя",
};
const CASE_MATCH_PAIRS_PER_ROUND = 5;

let caseMatchAlphabet = "no";
let caseMatchLeft = [];
let caseMatchRight = [];
let caseMatchPairs = {};
let caseMatchChecked = false;
let caseMatchStatus = {};
let caseMatchDrag = null;

function newCaseMatchRound() {
  const all = [...(CASE_MATCH_ALPHABETS[caseMatchAlphabet] || CASE_MATCH_ALPHABETS.no)];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const picks = all.slice(0, CASE_MATCH_PAIRS_PER_ROUND);
  // For each pair, independently flip which case lives on which side
  // so both columns end up with a mix of upper- and lowercase letters.
  const leftItems = [];
  const rightItems = [];
  for (const letter of picks) {
    const upper = letter.toUpperCase();
    if (Math.random() < 0.5) { leftItems.push(letter); rightItems.push(upper); }
    else                     { leftItems.push(upper);  rightItems.push(letter); }
  }
  caseMatchLeft  = leftItems.sort(() => Math.random() - 0.5);
  caseMatchRight = rightItems.sort(() => Math.random() - 0.5);
  caseMatchPairs = {};
  caseMatchChecked = false;
  caseMatchStatus = {};
  caseMatchDrag = null;
}

function caseMatchBody(alphabet = "no") {
  caseMatchAlphabet = CASE_MATCH_ALPHABETS[alphabet] ? alphabet : "no";
  newCaseMatchRound();
  // Defer wiring + line layout until DOM is in place.
  setTimeout(() => { bindCaseMatchHandlers(); updateCaseMatchLines(); }, 0);
  return renderCaseMatch();
}

function renderCaseMatch() {
  const leftHtml = caseMatchLeft.map((l, i) => {
    const paired = caseMatchPairs[i] !== undefined;
    const status = caseMatchStatus[i];
    const cls = ["sl-cell", "left", paired ? "paired" : "", status || ""].filter(Boolean).join(" ");
    return `<div class="${cls}" data-side="left" data-idx="${i}">${l}</div>`;
  }).join("");

  const rightHtml = caseMatchRight.map((u, j) => {
    let leftIdx = null;
    for (const [li, ri] of Object.entries(caseMatchPairs)) {
      if (Number(ri) === j) { leftIdx = Number(li); break; }
    }
    const paired = leftIdx !== null;
    const status = paired ? caseMatchStatus[leftIdx] : "";
    const cls = ["sl-cell", "right", paired ? "paired" : "", status || ""].filter(Boolean).join(" ");
    return `<div class="${cls}" data-side="right" data-idx="${j}">${u}</div>`;
  }).join("");

  const linesHtml = Object.entries(caseMatchPairs).map(([li, rj]) => {
    const status = caseMatchStatus[li] || "";
    return `<line class="sl-line ${status}" data-li="${li}" data-rj="${rj}"/>`;
  }).join("");

  const allPaired = Object.keys(caseMatchPairs).length === CASE_MATCH_PAIRS_PER_ROUND;
  const allCorrect = caseMatchChecked
    && Object.keys(caseMatchStatus).length === CASE_MATCH_PAIRS_PER_ROUND
    && Object.values(caseMatchStatus).every((s) => s === "correct");
  const btnLabel = allCorrect ? "Neste" : "Sjekk";
  const btnAction = allCorrect ? "storliten-next" : "storliten-check";
  const btnDisabled = !allCorrect && !allPaired;

  return `
    <div class="sl-board">
      <div class="sl-cols">
        <div class="sl-col left">${leftHtml}</div>
        <svg class="sl-svg" xmlns="http://www.w3.org/2000/svg">${linesHtml}<line class="sl-drag-line" style="display:none"/></svg>
        <div class="sl-col right">${rightHtml}</div>
      </div>
      <button class="sl-btn ${btnDisabled ? "disabled" : ""}" data-action="${btnAction}" ${btnDisabled ? "disabled" : ""}>${btnLabel}</button>
    </div>`;
}

let caseMatchDocBound = false;

function bindCaseMatchHandlers() {
  const board = pageBody.querySelector(".sl-board");
  if (!board) return;
  board.addEventListener("pointerdown", onCaseMatchPointerDown);
  // Move + release land on document so we don't lose the gesture if
  // the captured cell is removed by a re-render, the finger leaves the
  // board, or WPE fires pointercancel instead of pointerup on touch.
  if (!caseMatchDocBound) {
    document.addEventListener("pointermove", onCaseMatchPointerMove);
    document.addEventListener("pointerup", onCaseMatchPointerUp);
    document.addEventListener("pointercancel", onCaseMatchPointerUp);
    caseMatchDocBound = true;
  }
}

function reRenderCaseMatch() {
  pageBody.innerHTML = renderCaseMatch();
  bindCaseMatchHandlers();
  requestAnimationFrame(updateCaseMatchLines);
}

function onCaseMatchPointerDown(e) {
  const cell = e.target.closest(".sl-cell");
  if (!cell) return;
  e.preventDefault();
  e.stopPropagation();

  // After Sjekk: tapping any cell clears every wrong pair so the user can
  // redraw them. Correct pairs stay locked.
  if (caseMatchChecked) {
    let cleared = false;
    for (const li of Object.keys(caseMatchStatus)) {
      if (caseMatchStatus[li] === "wrong") {
        delete caseMatchPairs[Number(li)];
        delete caseMatchStatus[Number(li)];
        cleared = true;
      }
    }
    if (cleared) {
      caseMatchChecked = false;
      reRenderCaseMatch();
      return;
    }
  }

  caseMatchDrag = {
    srcSide: cell.dataset.side,
    srcIdx: Number(cell.dataset.idx),
    x: e.clientX, y: e.clientY,
    startX: e.clientX, startY: e.clientY,
    pointerId: e.pointerId,
  };
  // No pointer capture — document-level move/up handlers track the gesture.
  showDragLineFromCell();
}

// Geometric hit-test: find the closest cell on the opposite side to the
// release point. elementFromPoint is unreliable on the WPE/touch stack
// when pointer capture is active, so we measure distance to each cell's
// center and snap to the nearest one within a generous radius.
function nearestOppositeCell(x, y, srcSide) {
  const oppSide = srcSide === "left" ? "right" : "left";
  let best = null;
  let bestDist = Infinity;
  for (const cell of pageBody.querySelectorAll(`.sl-cell.${oppSide}`)) {
    const r = cell.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestDist) { best = cell; bestDist = d; }
  }
  return { cell: best, dist: bestDist };
}

function onCaseMatchPointerMove(e) {
  if (!caseMatchDrag) return;
  e.preventDefault();
  caseMatchDrag.x = e.clientX;
  caseMatchDrag.y = e.clientY;
  updateDragLine();
}

function onCaseMatchPointerUp(e) {
  if (!caseMatchDrag) return;
  e.preventDefault();
  const dx = e.clientX - caseMatchDrag.startX;
  const dy = e.clientY - caseMatchDrag.startY;
  const dragged = Math.hypot(dx, dy) >= 24; // ignore accidental taps
  if (dragged) {
    const { cell: target, dist } = nearestOppositeCell(e.clientX, e.clientY, caseMatchDrag.srcSide);
    if (target) {
      const r = target.getBoundingClientRect();
      // Generous hit zone — release within ~1.5× the cell size from any
      // opposite-side cell center counts as a drop on it.
      const radius = Math.max(r.width, r.height) * 1.5;
      if (dist <= radius) {
        const tIdx = Number(target.dataset.idx);
        const leftI  = caseMatchDrag.srcSide === "left"  ? caseMatchDrag.srcIdx : tIdx;
        const rightJ = caseMatchDrag.srcSide === "right" ? caseMatchDrag.srcIdx : tIdx;
        delete caseMatchPairs[leftI];
        for (const [li, ri] of Object.entries(caseMatchPairs)) {
          if (Number(ri) === rightJ) delete caseMatchPairs[Number(li)];
        }
        caseMatchPairs[leftI] = rightJ;
        caseMatchChecked = false;
        caseMatchStatus = {};
      }
    }
  }
  caseMatchDrag = null;
  reRenderCaseMatch();
}

function showDragLineFromCell() {
  if (!caseMatchDrag) return;
  const cell = pageBody.querySelector(`.sl-cell.${caseMatchDrag.srcSide}[data-idx="${caseMatchDrag.srcIdx}"]`);
  const svg = pageBody.querySelector(".sl-svg");
  const dragLine = pageBody.querySelector(".sl-drag-line");
  if (!cell || !svg || !dragLine) return;
  const cr = cell.getBoundingClientRect();
  const sr = svg.getBoundingClientRect();
  const x = cr.left + cr.width / 2 - sr.left;
  const y = cr.top  + cr.height / 2 - sr.top;
  dragLine.setAttribute("x1", x);
  dragLine.setAttribute("y1", y);
  dragLine.setAttribute("x2", x);
  dragLine.setAttribute("y2", y);
  dragLine.style.display = "";
}

function updateDragLine() {
  if (!caseMatchDrag) return;
  const svg = pageBody.querySelector(".sl-svg");
  const dragLine = pageBody.querySelector(".sl-drag-line");
  if (!svg || !dragLine) return;
  const sr = svg.getBoundingClientRect();
  dragLine.setAttribute("x2", caseMatchDrag.x - sr.left);
  dragLine.setAttribute("y2", caseMatchDrag.y - sr.top);
}

function updateCaseMatchLines() {
  const svg = pageBody.querySelector(".sl-svg");
  if (!svg) return;
  const sr = svg.getBoundingClientRect();
  svg.querySelectorAll(".sl-line").forEach((line) => {
    const li = Number(line.dataset.li);
    const rj = Number(line.dataset.rj);
    const lc = pageBody.querySelector(`.sl-cell.left[data-idx="${li}"]`);
    const rc = pageBody.querySelector(`.sl-cell.right[data-idx="${rj}"]`);
    if (!lc || !rc) return;
    const lr = lc.getBoundingClientRect();
    const rr = rc.getBoundingClientRect();
    line.setAttribute("x1", lr.right - sr.left);
    line.setAttribute("y1", lr.top + lr.height / 2 - sr.top);
    line.setAttribute("x2", rr.left  - sr.left);
    line.setAttribute("y2", rr.top + rr.height / 2 - sr.top);
  });
}

function caseMatchCheck() {
  if (Object.keys(caseMatchPairs).length !== CASE_MATCH_PAIRS_PER_ROUND) return;
  caseMatchChecked = true;
  caseMatchStatus = {};
  for (const [li, rj] of Object.entries(caseMatchPairs)) {
    const left  = caseMatchLeft[Number(li)];
    const right = caseMatchRight[Number(rj)];
    // Either column may hold the upper- or lowercase form, so compare
    // case-insensitively. (A pick like {a,A} guarantees the two sides
    // hold opposite cases of the same letter.)
    caseMatchStatus[Number(li)] = left.toLowerCase() === right.toLowerCase() ? "correct" : "wrong";
  }
  reRenderCaseMatch();
  if (Object.values(caseMatchStatus).every((s) => s === "correct")) {
    earnCoin();
  }
}

function caseMatchNext() {
  newCaseMatchRound();
  reRenderCaseMatch();
}

function writeCorrectFeedback() {
  // Ukrainian "great job" has separate masculine and feminine forms;
  // Norwegian "Bra!" is gender-neutral.
  if (writeMode === "ukrainsk") {
    return kioskConfig.gender === "male" ? "✓ Молодець!" : "✓ Молодчинка!";
  }
  return WRITE_LANGS[writeMode].feedback.correct;
}

function newWriteWord() {
  const rank = (n) => n === "hard" ? 2 : n === "medium" ? 1 : 0;
  const cur = rank(getLevel());
  const list = WRITE_LANGS[writeMode].words.filter(
    (w) => !w.minLevel || cur >= rank(w.minLevel)
  );
  let next;
  for (let i = 0; i < 8; i++) {
    next = list[Math.floor(Math.random() * list.length)];
    if (next.word !== writePrev) break;
  }
  writeWord = next;
  writePrev = next.word;
  writeInput = "";
  writeState = "input";
}

function renderWrite() {
  const w = writeWord.word;
  const slots = [...w].map((_, i) =>
    `<span class="d">${writeInput[i] ?? "_"}</span>`
  ).join("");
  const feedback =
    writeState === "correct" ? writeCorrectFeedback() :
    writeState === "wrong"   ? WRITE_LANGS[writeMode].feedback.wrong : "";

  const layout = WRITE_LANGS[writeMode].kbd;
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
      <div class="skrive-board ${writeState}">
        <div class="skrive-question">
          <div class="skrive-image" aria-hidden="true">${writeWord.emoji}</div>
          <div class="skrive-word">${slots}</div>
        </div>
        <div class="skrive-feedback">${feedback}</div>
      </div>
      <div class="skrive-kbd">${kbd}</div>
    </div>`;
}

function writeKey(k) {
  if (writeState === "correct") return; // wait for next word
  if (k === "⌫") return writeBackspace();
  if (k === "⏎") return writeCheck();
  // anything else is a letter (or space) to insert
  if (writeState === "wrong") writeState = "input";
  if (writeInput.length >= writeWord.word.length) return;
  writeInput += k;
  pageBody.innerHTML = renderWrite();
}

function writeBackspace() {
  if (writeState === "correct") return;
  if (writeState === "wrong") writeState = "input";
  if (writeInput.length === 0) return;
  writeInput = writeInput.slice(0, -1);
  pageBody.innerHTML = renderWrite();
}

function writeCheck() {
  if (writeState === "correct") return;
  if (writeInput.toUpperCase() === writeWord.word) {
    writeState = "correct";
    pageBody.innerHTML = renderWrite();
    earnCoin();
    setTimeout(() => {
      newWriteWord();
      pageBody.innerHTML = renderWrite();
    }, 1500);
  } else {
    writeState = "wrong";
    pageBody.innerHTML = renderWrite();
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

// Calendar events live on the server now (data/events.json, importable
// from .ics). The kiosk fetches the day's events on render and caches the
// result keyed by date.
const EVENT_ICONS = {
  swim:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="8" r="1.6"/><path d="M8 9c2 -1 5 -1 8 1"/><path d="M2 15c2 -1.5 4 -1.5 6 0s4 1.5 6 0 4 -1.5 6 0"/><path d="M2 19c2 -1.5 4 -1.5 6 0s4 1.5 6 0 4 -1.5 6 0"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="17" r="2.3" fill="currentColor"/><circle cx="17.5" cy="15" r="2.3" fill="currentColor"/><line x1="8.8" y1="17" x2="8.8" y2="6"/><line x1="19.8" y1="15" x2="19.8" y2="4"/><line x1="8.8" y1="6" x2="19.8" y2="4"/></svg>',
  cake:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="12" width="18" height="9" rx="1.2"/><path d="M3 16c3 1.6 6 1.6 9 0s6 -1.6 9 0"/><line x1="12" y1="12" x2="12" y2="6"/><path d="M12 6c-1 -0.8 -1 -2.5 0 -3 1 0.5 1 2.2 0 3z" fill="currentColor"/></svg>',
  event: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/></svg>',
};

const eventsCache = new Map(); // "YYYY-MM-DD" → array of {summary,icon}
let calendarEventsForRender = []; // events for the date currently shown

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchEventsFor(d) {
  const key = dateKey(d);
  if (eventsCache.has(key)) return eventsCache.get(key);
  try {
    const r = await fetch(`/api/events/${key}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const list = await r.json();
    eventsCache.set(key, list);
    return list;
  } catch (_) {
    return [];
  }
}

let calendarDate = null;

function calendarBody() {
  const d = calendarDate ?? new Date();
  // Sync render-state to the cache for this date, then fire async fetch
  // so a missing cache entry gets filled and we re-render on arrival.
  calendarEventsForRender = eventsCache.get(dateKey(d)) ?? [];
  loadEventsForCurrentDate();
  const weekday = d.toLocaleDateString("nb-NO", { weekday: "long" });
  const month = d.toLocaleDateString("nb-NO", { month: "long" });
  const events = calendarEventsForRender;
  const isToday = sameYMD(d, new Date());
  const eventsHtml = events.length
    ? events.map((e) => `
        <div class="event">
          <div class="event-icon">${EVENT_ICONS[e.icon || "event"] ?? EVENT_ICONS.event}</div>
          <div class="event-label">${escapeHtml(e.summary || "")}</div>
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
  calendarEventsForRender = eventsCache.get(dateKey(next)) ?? [];
  pageBody.innerHTML = calendarBody();
}

async function loadEventsForCurrentDate() {
  const d = calendarDate ?? new Date();
  const key = dateKey(d);
  const wanted = key;
  const list = await fetchEventsFor(d);
  // Only re-render if the user is still on the same date and on /kalender.
  if (location.hash !== "#/kalender") return;
  const stillOnSameDate = dateKey(calendarDate ?? new Date()) === wanted;
  if (!stillOnSameDate) return;
  if (JSON.stringify(list) === JSON.stringify(calendarEventsForRender)) return;
  calendarEventsForRender = list;
  pageBody.innerHTML = calendarBody();
}

const SETTINGS_TILES = [
  { route: "bakgrunn", titleKey: "page.background", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M3 17l4-4 4 4 5-5 5 5"/></svg>' },
  { route: "lock",     titleKey: "page.lock",       icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' },
  // Full navigation to the admin panel (not an SPA route) — the server asks
  // for the admin password, so the tile is safe to show on the kid's grid.
  { route: "voksen",   titleKey: "page.adult",      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7.5" r="3.5"/><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/></svg>' },
];

const SETTINGS_PLACEHOLDER_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l3 16H6z"/><line x1="7.7" y1="11" x2="16.3" y2="11"/><line x1="6.7" y1="16" x2="17.3" y2="16"/><line x1="3" y1="20" x2="21" y2="20"/></svg>';

function settingsBody() {
  const tiles = [];
  for (let i = 0; i < 6; i++) {
    const tile = SETTINGS_TILES[i];
    if (tile) {
      const label = tile.titleKey ? t(tile.titleKey) : (tile.title || "");
      tiles.push(`
        <button class="setting-tile" data-route="${tile.route}">
          <div class="setting-icon">${tile.icon}</div>
          <div class="setting-title">${label}</div>
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

// --- VALG → Lås (kiosk-side passcode setter; reaches a localhost-only
//     endpoint so it doesn't need admin auth) ---

let lockEditPattern = [];

function lockSettingBody() {
  lockEditPattern = [];
  return renderLockSetting();
}

function renderLockSetting() {
  const current = Array.isArray(kioskConfig.lock_pattern) ? kioskConfig.lock_pattern : [];
  const slots = [0, 1, 2].map((i) => {
    const c = lockEditPattern[i];
    const bg = c ? `background:${LOCK_COLOR_HEX[c] || c}` : "";
    return `<div class="lock-edit-slot ${c ? "filled" : ""}" style="${bg}"></div>`;
  }).join("");
  const palette = LOCK_COLORS.map((c) =>
    `<button class="lock-edit-color" data-action="lock-pick" data-color="${c}" style="background:${LOCK_COLOR_HEX[c] || c}" aria-label="${c}"></button>`
  ).join("");
  const currentDisplay = current.length === 3
    ? current.map((c) => `<span class="lock-mini" style="background:${LOCK_COLOR_HEX[c] || c}"></span>`).join("")
    : `<em class="lock-none">${t("lock.none_set")}</em>`;
  const canSave = lockEditPattern.length === 3;
  return `
    <div class="lock-setting">
      <div class="lock-current-row">
        <span class="lock-current-label">${t("lock.current_label")}</span>
        <span class="lock-current-display">${currentDisplay}</span>
      </div>
      <div class="lock-edit-slots">${slots}</div>
      <div class="lock-edit-palette">${palette}</div>
      <div class="lock-edit-buttons">
        <button class="lock-edit-btn back" type="button" data-action="lock-edit-back" aria-label="back">⌫</button>
        <button class="lock-edit-btn save" type="button" data-action="lock-edit-save" ${canSave ? "" : "disabled"}>${t("common.save")}</button>
        <button class="lock-edit-btn clear" type="button" data-action="lock-edit-clear">${t("admin.lock.clear")}</button>
      </div>
    </div>`;
}

function lockSettingPick(color) {
  if (lockEditPattern.length >= 3) return;
  if (!LOCK_COLORS.includes(color)) return;
  lockEditPattern.push(color);
  pageBody.innerHTML = renderLockSetting();
}

function lockSettingBack() {
  if (lockEditPattern.length === 0) return;
  lockEditPattern.pop();
  pageBody.innerHTML = renderLockSetting();
}

async function lockSettingSave() {
  if (lockEditPattern.length !== 3) return;
  try {
    const r = await fetch("/api/lock_pattern", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern: lockEditPattern }),
    });
    if (!r.ok) return;
    const data = await r.json();
    kioskConfig.lock_pattern = data.lock_pattern || [];
    if (typeof updateLockTriggerVisibility === "function") updateLockTriggerVisibility();
    lockEditPattern = [];
    pageBody.innerHTML = renderLockSetting();
  } catch (_) {}
}

async function lockSettingClear() {
  try {
    const r = await fetch("/api/lock_pattern", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern: [] }),
    });
    if (!r.ok) return;
    kioskConfig.lock_pattern = [];
    if (typeof updateLockTriggerVisibility === "function") updateLockTriggerVisibility();
    lockEditPattern = [];
    pageBody.innerHTML = renderLockSetting();
  } catch (_) {}
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

function workBody() {
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
      <div class="jobb-editor" id="jobb-editor">${workEditorEmpty()}</div>
    </div>`;
}

function workEditorEmpty() {
  return `<div class="jobb-empty">Velg en fil eller lag en ny</div>`;
}

function workEditorOpen() {
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
    document.getElementById("jobb-editor").innerHTML = workEditorOpen();
    renderJobsList();
  } catch (_) {}
}

function newJob() {
  activeJobId = null;
  activeJobTitle = "";
  activeJobContent = "";
  document.getElementById("jobb-editor").innerHTML = workEditorOpen();
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
      document.getElementById("jobb-editor").innerHTML = workEditorOpen();
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
    document.getElementById("jobb-editor").innerHTML = workEditorEmpty();
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
  syncTimerForRoute();
}

function showPage(id) {
  const def = PAGES[id];
  if (!def) return showHome();
  if (id === "kalender") calendarDate = null; // reset to today on each entry
  pageTitle.textContent = def.titleKey ? t(def.titleKey) : (def.title || "");
  pageBody.innerHTML = def.body();
  pageBody.classList.toggle("fullbleed", !!def.fullbleed);
  home.classList.add("hidden");
  page.classList.remove("hidden");
  if (location.hash !== `#/${id}`) {
    history.replaceState(null, "", `#/${id}`);
  }
  syncTimerForRoute();
}

// --- Activity timer ---------------------------------------------------
// Counts down only while the user is on an "activity" (leaf) page —
// menus/galleries/landings don't burn the budget. When it hits 0 we
// pop a 6-color time-up overlay; correct unlock lets the kid pick from
// the admin-configured extension options (default 10 / 15 / 20 min).

const ACTIVITY_ROUTES = new Set([
  "lese-read",
  "skrive-norsk", "skrive-ukrainsk", "skrive-engelsk",
  "skrive-storliten", "skrive-storliten-ua",
  "tall", "gange",
  "naturfag-kroppen", "naturfag-folelser",
  "trening-read",
  "jobb",
]);
const TIME_REMAINING_KEY = "asipad_time_remaining";
// localStorage (not session) — the "restore after a break" check must survive
// a browser/app restart, which is exactly when a long break tends to happen.
const TIME_LAST_USED_KEY = "asipad_time_last_used";
let timeRemaining = null; // seconds; null until first sync
let timeInterval = null;

function isActivityRoute(hash) {
  const m = (hash || "").match(/^#\/(.+)/);
  return !!m && ACTIVITY_ROUTES.has(m[1]);
}

function timerEnabled() {
  return Number(kioskConfig.time_budget_minutes || 0) > 0;
}

function timerBudgetSeconds() {
  return Number(kioskConfig.time_budget_minutes || 0) * 60;
}

function timeRestoreHours() {
  return Number(kioskConfig.time_restore_hours || 0);
}

// "Restore activity time after a break": if the timer hasn't ticked for the
// configured number of hours, refill to the full budget. Checked on init and
// on every navigation, so a kiosk that stays running for days still restores.
function maybeRestoreTime() {
  const hours = timeRestoreHours();
  if (!timerEnabled() || hours <= 0) return;
  const last = parseInt(localStorage.getItem(TIME_LAST_USED_KEY) ?? "", 10);
  if (!Number.isFinite(last)) return;
  if (Date.now() - last >= hours * 3600 * 1000) {
    timeRemaining = timerBudgetSeconds();
    persistTimeRemaining();
  }
}

function initTimeRemaining() {
  if (!timerEnabled()) { timeRemaining = null; return; }
  const stored = parseInt(sessionStorage.getItem(TIME_REMAINING_KEY) ?? "", 10);
  if (Number.isFinite(stored) && stored >= 0) {
    timeRemaining = stored;
  } else {
    timeRemaining = timerBudgetSeconds();
    sessionStorage.setItem(TIME_REMAINING_KEY, String(timeRemaining));
  }
  maybeRestoreTime();
}

function persistTimeRemaining() {
  if (timeRemaining !== null) {
    sessionStorage.setItem(TIME_REMAINING_KEY, String(timeRemaining));
    try { localStorage.setItem(TIME_LAST_USED_KEY, String(Date.now())); } catch (_) {}
  }
}

function ensureTimerEl() {
  let el = document.getElementById("activity-timer");
  if (!el) {
    el = document.createElement("div");
    el.id = "activity-timer";
    document.body.appendChild(el);
  }
  return el;
}

function renderTimerEl() {
  const el = ensureTimerEl();
  if (!timerEnabled() || timeRemaining === null) {
    el.style.display = "none";
    return;
  }
  el.style.display = "";
  const total = Math.max(0, timeRemaining);
  const m = Math.floor(total / 60);
  const s = total % 60;
  el.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  el.classList.toggle("low", total < 60);
}

function timerTick() {
  if (timeRemaining > 0) {
    timeRemaining--;
    persistTimeRemaining();
    renderTimerEl();
  }
  if (timeRemaining <= 0) {
    stopTimerInterval();
    renderTimerEl();
    showTimeUpOverlay();
  }
}

function startTimerInterval() { if (!timeInterval) timeInterval = setInterval(timerTick, 1000); }
function stopTimerInterval()  { if (timeInterval) { clearInterval(timeInterval); timeInterval = null; } }

// Called on every navigation. Tick only on activity routes; freeze on menus.
function syncTimerForRoute() {
  if (!timerEnabled()) { stopTimerInterval(); renderTimerEl(); return; }
  if (timeRemaining === null) initTimeRemaining();
  else maybeRestoreTime();
  renderTimerEl();
  if (isActivityRoute(location.hash)) {
    if (timeRemaining <= 0) {
      stopTimerInterval();
      showTimeUpOverlay();
      return;
    }
    startTimerInterval();
  } else {
    stopTimerInterval();
  }
}

// --- Time-up overlay --------------------------------------------------
// Two phases: (1) password entry, (2) pick how much time to add.
// Password is `time_extension_pattern` (6 colors). On miss we shake.

function showTimeUpOverlay() {
  if (document.querySelector(".time-up-overlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "lock-overlay time-up-overlay";

  const expected = Array.isArray(kioskConfig.time_extension_pattern)
    ? kioskConfig.time_extension_pattern : [];
  const opts = Array.isArray(kioskConfig.time_extension_options)
    ? kioskConfig.time_extension_options : [10, 15, 20];
  const entry = []; // user's pattern so far

  const renderEntry = () => {
    const slotsHtml = [0,1,2,3,4,5].map((i) => {
      const c = entry[i];
      const bg = c ? `background:${LOCK_COLOR_HEX[c] || c}` : "";
      return `<div class="lock-slot ${c?'filled':''}" style="${bg}"></div>`;
    }).join("");
    const palette = LOCK_COLORS.map((c) =>
      `<button class="lock-color color-${c}" data-action="time-pick" data-color="${c}" aria-label="${c}"></button>`
    ).join("");
    overlay.innerHTML = `
      <div class="lock-icon" aria-hidden="true">⏰</div>
      <div class="lock-title">${t("time.add_more")}</div>
      <div class="lock-instruction">${t("time.unlock_instruction")}</div>
      <div class="lock-slots">${slotsHtml}</div>
      <div class="lock-palette">
        ${palette}
        <button class="lock-backspace" data-action="time-back" aria-label="back">⌫</button>
      </div>`;
  };

  const renderChooseTime = () => {
    overlay.innerHTML = `
      <div class="lock-icon" aria-hidden="true">⏰</div>
      <div class="lock-title">${t("time.choose_title")}</div>
      <div class="time-options">
        ${opts.map((min) =>
          `<button class="time-option" data-action="time-add" data-min="${min}">+${min} min</button>`
        ).join("")}
      </div>`;
  };

  renderEntry();
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset?.action;
    if (!action) return;
    if (action === "time-pick") {
      const c = e.target.closest("[data-color]")?.dataset?.color;
      if (!c || entry.length >= 6) return;
      entry.push(c);
      if (entry.length === 6) {
        const ok = expected.length === 6 && entry.every((v, i) => v === expected[i]);
        if (ok) {
          renderChooseTime();
        } else {
          overlay.classList.add("shake");
          setTimeout(() => {
            overlay.classList.remove("shake");
            entry.length = 0;
            renderEntry();
          }, 380);
        }
      } else {
        renderEntry();
      }
    } else if (action === "time-back") {
      if (entry.length === 0) return;
      entry.pop();
      renderEntry();
    } else if (action === "time-add") {
      const min = parseInt(e.target.closest("[data-min]")?.dataset?.min, 10);
      if (!Number.isFinite(min) || min <= 0) return;
      timeRemaining = (timeRemaining || 0) + min * 60;
      persistTimeRemaining();
      renderTimerEl();
      overlay.remove();
      syncTimerForRoute();
    }
  });
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
    if (k) return writeKey(k);
  }
  if (action === "tap-pick") {
    const id = e.target.closest("[data-id]")?.dataset?.id;
    if (id) return tapPick(id);
  }
  if (action === "storliten-check") return caseMatchCheck();
  if (action === "storliten-next")  return caseMatchNext();
  if (action === "bilder-open") {
    const id = e.target.closest("[data-bilder-id]")?.dataset?.bilderId;
    if (id) return openBilder(id);
  }
  if (action === "lock-pick") {
    const c = e.target.closest("[data-color]")?.dataset?.color;
    if (c) return lockSettingPick(c);
  }
  if (action === "lock-edit-back")  return lockSettingBack();
  if (action === "lock-edit-save")  return lockSettingSave();
  if (action === "lock-edit-clear") return lockSettingClear();
  if (action === "bilder-prev") { bilderPage--; return renderBilderPage(); }
  if (action === "bilder-next") { bilderPage++; return renderBilderPage(); }
  if (action === "video-open") {
    const id = e.target.closest("[data-video-id]")?.dataset?.videoId;
    if (id) return openVideo(id);
  }
  if (action === "video-prev") { videoPage--; return renderVideoPage(); }
  if (action === "video-next") { videoPage++; return renderVideoPage(); }
  if (action === "gif-open") {
    const id = e.target.closest("[data-gif-id]")?.dataset?.gifId;
    if (id) return openGif(id);
  }
  if (action === "gif-prev") { gifPage--; return renderGifPage(); }
  if (action === "gif-next") { gifPage++; return renderGifPage(); }
  if (action === "trening-open") {
    const id = e.target.closest("[data-trening-id]")?.dataset?.treningId;
    if (id) return openTrening(id);
  }
  if (action === "trening-prev") return shiftTreningPage(-1);
  if (action === "trening-next") return shiftTreningPage(1);
  const route = e.target?.closest?.("[data-route]")?.dataset?.route;
  if (route === "voksen") { window.location.href = "/admin"; return; }
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

// --- Lock screen ----------------------------------------------------
// Tap padlock → set sessionStorage["asipad_locked"]=1 and show overlay.
// Overlay = full-screen z=2000 panel: lock icon, three slot circles,
// 7 rainbow buttons + a backspace. Match kioskConfig.lock_pattern to
// unlock; mismatch shakes + clears slots. State survives reload via
// sessionStorage so a kid's reload can't bypass it.

const LOCK_COLORS = ["red", "orange", "yellow", "green", "blue", "violet"];
const LOCK_KEY = "asipad_locked";
const lockTrigger = $("#lock-trigger");
let lockOverlayEl = null;
let lockEntry = [];
let lockFeedbackTimer = null;

function hasLockConfigured() {
  const lp = kioskConfig?.lock_pattern;
  return Array.isArray(lp) && lp.length === 3 && lp.every((c) => LOCK_COLORS.includes(c));
}

function updateLockTriggerVisibility() {
  if (!lockTrigger) return;
  if (hasLockConfigured()) {
    lockTrigger.removeAttribute("hidden");
  } else {
    lockTrigger.setAttribute("hidden", "");
    // If admin cleared the pattern while we were locked, drop the overlay
    // — otherwise the kiosk would be stranded with no way to unlock.
    if (lockOverlayEl) hideLockOverlay();
    sessionStorage.removeItem(LOCK_KEY);
  }
}

function buildLockOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "lock-overlay";
  overlay.innerHTML = `
    <svg class="lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="1.6"/>
      <path d="M8 11V8a4 4 0 0 1 8 0v3"/>
    </svg>
    <h2 class="lock-title">${escapeHtml(t("lock.locked_title"))}</h2>
    <p class="lock-instruction">${escapeHtml(t("lock.enter_pattern"))}</p>
    <div class="lock-slots" role="status" aria-live="polite">
      <div class="lock-slot" data-slot="0"></div>
      <div class="lock-slot" data-slot="1"></div>
      <div class="lock-slot" data-slot="2"></div>
      <button type="button" class="lock-backspace" data-action="lock-back" aria-label="⌫">⌫</button>
    </div>
    <p class="lock-feedback" data-feedback></p>
    <div class="lock-palette">
      ${LOCK_COLORS.map((c) =>
        `<button type="button" class="lock-color color-${c}" data-action="lock-color" data-color="${c}" aria-label="${c}"></button>`
      ).join("")}
    </div>`;
  overlay.addEventListener("pointerup", onLockOverlayTap);
  return overlay;
}

function showLockOverlay() {
  if (lockOverlayEl) return;
  lockEntry = [];
  lockOverlayEl = buildLockOverlay();
  document.body.appendChild(lockOverlayEl);
}

function hideLockOverlay() {
  if (!lockOverlayEl) return;
  lockOverlayEl.remove();
  lockOverlayEl = null;
  lockEntry = [];
  if (lockFeedbackTimer) { clearTimeout(lockFeedbackTimer); lockFeedbackTimer = null; }
}

// Hex values mirror the .color-* CSS rules — kept in JS too because the
// slots paint via inline background, not class composition (the slot
// element already has its own border/size styling we don't want to clash).
const LOCK_COLOR_HEX = {
  red:    "#e53935",
  orange: "#fb8c00",
  yellow: "#fdd835",
  green:  "#43a047",
  blue:   "#1e88e5",
  indigo: "#3949ab",
  violet: "#8e24aa",
};

function paintLockSlots() {
  if (!lockOverlayEl) return;
  for (let i = 0; i < 3; i++) {
    const el = lockOverlayEl.querySelector(`.lock-slot[data-slot="${i}"]`);
    if (!el) continue;
    const c = lockEntry[i];
    if (c) {
      el.classList.add("filled");
      el.style.background = LOCK_COLOR_HEX[c] || "";
    } else {
      el.classList.remove("filled");
      el.style.background = "";
    }
  }
}

function onLockOverlayTap(e) {
  const btn = e.target?.closest?.("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "lock-back") {
    if (lockEntry.length > 0) {
      lockEntry.pop();
      paintLockSlots();
    }
    return;
  }
  if (action === "lock-color") {
    if (lockEntry.length >= 3) return;
    lockEntry.push(btn.dataset.color);
    paintLockSlots();
    if (lockEntry.length === 3) checkLockEntry();
  }
}

function checkLockEntry() {
  const expected = kioskConfig.lock_pattern || [];
  const ok = expected.length === 3 && lockEntry.every((c, i) => c === expected[i]);
  if (ok) {
    sessionStorage.removeItem(LOCK_KEY);
    hideLockOverlay();
    return;
  }
  // Wrong: shake + flash feedback, clear after a moment.
  if (lockOverlayEl) {
    lockOverlayEl.classList.add("shake");
    const fb = lockOverlayEl.querySelector("[data-feedback]");
    if (fb) fb.textContent = t("lock.try_again");
    if (lockFeedbackTimer) clearTimeout(lockFeedbackTimer);
    lockFeedbackTimer = setTimeout(() => {
      if (!lockOverlayEl) return;
      lockOverlayEl.classList.remove("shake");
      lockEntry = [];
      paintLockSlots();
      const fb2 = lockOverlayEl.querySelector("[data-feedback]");
      if (fb2) fb2.textContent = "";
    }, 700);
  }
}

if (lockTrigger) {
  bindTap(lockTrigger, () => {
    if (!hasLockConfigured()) return;
    sessionStorage.setItem(LOCK_KEY, "1");
    showLockOverlay();
  });
}

// On every page load: if we were locked and a pattern still exists,
// re-show the overlay before the kid sees the kiosk.
if (sessionStorage.getItem(LOCK_KEY) === "1") {
  // Defer one tick so kioskConfig has a chance to be hydrated by the
  // initial /api/version response. If that hasn't landed yet we still
  // show the overlay (fail-closed) — applyConfig will hide it once the
  // server reports lock_pattern is empty.
  showLockOverlay();
}
updateLockTriggerVisibility();

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

let eventsVersion = null;

async function pollVersion() {
  try {
    const r = await fetch("/api/version", { cache: "no-store" });
    const { version, background, events, coins, config } = await r.json();
    if (bootVersion === null) bootVersion = version;
    else if (version !== bootVersion) return location.reload();
    if (bgVersion !== background) {
      bgVersion = background;
      applyBackground(background);
    }
    if (eventsVersion === null) {
      eventsVersion = events ?? 0;
    } else if ((events ?? 0) !== eventsVersion) {
      eventsVersion = events ?? 0;
      eventsCache.clear();
      // If the user is on the calendar page, re-render so cleared / freshly
      // imported events show up immediately instead of next visit.
      if (location.hash === "#/kalender" && PAGES.kalender) {
        pageBody.innerHTML = PAGES.kalender.body();
      }
    }
    if (typeof coins === "number" && coins !== coinCount) {
      coinCount = coins;
      if (location.hash === "#/bank" && PAGES.bank) {
        pageBody.innerHTML = PAGES.bank.body();
      }
    }
    if (config) applyConfig(config);
  } catch (_) { /* server may be restarting; try again */ }
}
pollVersion();
setInterval(pollVersion, 30000);
