const status = document.getElementById("status");
const library = document.getElementById("bg-library");
const form = document.getElementById("upload-form");
const fileInput = document.getElementById("file");
const fileLabel = document.getElementById("file-label");

function setStatus(text, kind = "") {
  status.textContent = text;
  status.className = kind;
}

async function refreshLibrary() {
  try {
    const r = await fetch("/api/backgrounds", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const items = await r.json();
    if (items.length === 0) {
      library.innerHTML = `<p class="empty">Ingen bakgrunner enda. Last opp et bilde under.</p>`;
      return;
    }
    library.innerHTML = items.map((b) => `
      <div class="mdc-card mdc-card--outlined bg-card ${b.current ? "current" : ""}" data-id="${b.id}">
        <button class="mdc-card__primary-action thumb" tabindex="0" data-action="use" aria-label="${b.current ? "Aktiv bakgrunn" : "Sett som aktiv"}">
          <span class="mdc-card__ripple"></span>
          <div class="mdc-card__media mdc-card__media--16-9" style="background-image:url('${b.url}')"></div>
          ${b.current ? `<span class="badge">Aktiv</span>` : ""}
        </button>
        <div class="mdc-card__actions">
          ${b.current
            ? `<button class="mdc-button mdc-card__action mdc-card__action--button" disabled><span class="mdc-button__label">Aktiv</span></button>`
            : `<button class="mdc-button mdc-card__action mdc-card__action--button" data-action="use"><span class="mdc-button__ripple"></span><span class="mdc-button__label">Bruk</span></button>`}
          <button class="mdc-icon-button mdc-card__action mdc-card__action--icon" data-action="delete" aria-label="Slett">
            <span class="mdc-icon-button__ripple"></span>
            <span class="material-icons">delete_outline</span>
          </button>
        </div>
      </div>
    `).join("");
    initMdcInside(library);
  } catch (err) {
    library.innerHTML = `<p class="error">Kunne ikke laste bakgrunner: ${err.message}</p>`;
  }
}

function initMdcInside(root) {
  if (typeof mdc === "undefined" || !root) return;
  root.querySelectorAll(".mdc-card__primary-action").forEach((el) => mdc.ripple.MDCRipple.attachTo(el));
  root.querySelectorAll(".mdc-button").forEach((el) => mdc.ripple.MDCRipple.attachTo(el));
  root.querySelectorAll(".mdc-icon-button").forEach((el) => {
    const r = mdc.ripple.MDCRipple.attachTo(el);
    r.unbounded = true;
  });
}

library.addEventListener("click", async (e) => {
  const card = e.target.closest(".bg-card");
  if (!card) return;
  const id = card.dataset.id;
  const action = e.target.closest("[data-action]")?.dataset?.action;
  if (!action) return;

  if (action === "use") {
    if (card.classList.contains("current")) return;
    setStatus("Setter aktiv bakgrunn…");
    try {
      const r = await fetch("/api/backgrounds/use", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStatus("Lagret.", "ok");
      refreshLibrary();
    } catch (err) {
      setStatus(`Feilet: ${err.message}`, "err");
    }
  } else if (action === "delete") {
    if (!confirm("Slette dette bildet?")) return;
    setStatus("Sletter…");
    try {
      const r = await fetch("/admin/background/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStatus("Slettet.", "ok");
      refreshLibrary();
    } catch (err) {
      setStatus(`Feilet: ${err.message}`, "err");
    }
  }
});

fileInput.addEventListener("change", () => {
  fileLabel.textContent = fileInput.files[0]?.name ?? "Velg bilde…";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = fileInput.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append("file", f);
  setStatus("Laster opp…");
  try {
    const r = await fetch("/admin/background", { method: "POST", body: fd });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(text || `HTTP ${r.status}`);
    }
    setStatus("Lastet opp.", "ok");
    fileInput.value = "";
    fileLabel.textContent = "Velg bilde…";
    refreshLibrary();
  } catch (err) {
    setStatus(`Feilet: ${err.message}`, "err");
  }
});

refreshLibrary();

// --- Pictures (FRITID/BILDER) ---

const pictureLibrary    = document.getElementById("pictures-library");
const pictureForm       = document.getElementById("picture-upload-form");
const pictureFile       = document.getElementById("picture-file");
const pictureFileLabel  = document.getElementById("picture-file-label");
const pictureStatus     = document.getElementById("picture-status");

function setPictureStatus(text, kind = "") {
  pictureStatus.textContent = text;
  pictureStatus.className = kind;
}

async function refreshPictures() {
  try {
    const r = await fetch("/api/pictures", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const items = await r.json();
    if (items.length === 0) {
      pictureLibrary.innerHTML = `<p class="empty">${t("bilder.empty")}</p>`;
      return;
    }
    pictureLibrary.innerHTML = items.map((p) => `
      <div class="mdc-card mdc-card--outlined bg-card" data-id="${p.id}">
        <div class="mdc-card__media mdc-card__media--16-9" style="background-image:url('${p.url}')"></div>
        <div class="mdc-card__actions">
          <button class="mdc-icon-button mdc-card__action mdc-card__action--icon" data-action="picture-delete" aria-label="Slett">
            <span class="mdc-icon-button__ripple"></span>
            <span class="material-icons">delete_outline</span>
          </button>
        </div>
      </div>
    `).join("");
    initMdcInside(pictureLibrary);
  } catch (err) {
    pictureLibrary.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

pictureLibrary.addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-action="picture-delete"]');
  if (!btn) return;
  const card = e.target.closest("[data-id]");
  const id = card?.dataset.id;
  if (!id) return;
  if (!confirm("Slette dette bildet?")) return;
  try {
    const r = await fetch("/admin/pictures/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    refreshPictures();
  } catch (err) {
    setPictureStatus(`Feilet: ${err.message}`, "err");
  }
});

pictureFile.addEventListener("change", () => {
  pictureFileLabel.textContent = pictureFile.files[0]?.name ?? t("admin.choose_image");
});

pictureForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = pictureFile.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append("file", f);
  setPictureStatus("Laster opp…");
  try {
    const r = await fetch("/admin/pictures", { method: "POST", body: fd });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setPictureStatus("Lastet opp.", "ok");
    pictureFile.value = "";
    pictureFileLabel.textContent = t("admin.choose_image");
    refreshPictures();
  } catch (err) {
    setPictureStatus(`Feilet: ${err.message}`, "err");
  }
});

refreshPictures();

// --- GIFs (FRITID/GIF) — animated images that play smoothly on Pi Zero 2 W ---

const gifLibrary    = document.getElementById("gifs-library");
const gifForm       = document.getElementById("gif-upload-form");
const gifFileInput  = document.getElementById("gif-file");
const gifFileLabel  = document.getElementById("gif-file-label");
const gifStatus     = document.getElementById("gif-status");

function setGifStatus(text, kind = "") {
  gifStatus.textContent = text;
  gifStatus.className = kind;
}

async function refreshGifs() {
  try {
    const r = await fetch("/api/gifs", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const items = await r.json();
    if (items.length === 0) {
      gifLibrary.innerHTML = `<p class="empty">${t("gif.empty")}</p>`;
      return;
    }
    gifLibrary.innerHTML = items.map((g) => `
      <div class="mdc-card mdc-card--outlined bg-card" data-id="${g.id}">
        <div class="mdc-card__media mdc-card__media--16-9" style="background-image:url('${g.poster_url || g.url}')"></div>
        <div class="rental-cost-row">
          <label>${t("admin.gifs.cost_label")}</label>
          <input type="number" min="0" max="999" value="${Number(g.cost ?? 9)}" data-action="gif-cost" data-id="${g.id}">
          <span class="rental-cost-hint">${t("admin.gifs.cost_free")}</span>
        </div>
        <div class="mdc-card__actions">
          <button class="mdc-icon-button mdc-card__action mdc-card__action--icon" data-action="gif-delete" aria-label="Slett">
            <span class="mdc-icon-button__ripple"></span>
            <span class="material-icons">delete_outline</span>
          </button>
        </div>
      </div>
    `).join("");
    initMdcInside(gifLibrary);
  } catch (err) {
    gifLibrary.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

gifLibrary.addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-action="gif-delete"]');
  if (!btn) return;
  const card = e.target.closest("[data-id]");
  const id = card?.dataset.id;
  if (!id) return;
  if (!confirm("Slette denne GIF-en?")) return;
  try {
    const r = await fetch("/admin/gifs/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    refreshGifs();
  } catch (err) {
    setGifStatus(`Feilet: ${err.message}`, "err");
  }
});

gifLibrary.addEventListener("change", async (e) => {
  const inp = e.target.closest('input[data-action="gif-cost"]');
  if (!inp) return;
  const id = inp.dataset.id;
  let cost = parseInt(inp.value, 10);
  if (!Number.isFinite(cost) || cost < 0) cost = 0;
  try {
    const r = await fetch("/admin/gifs/cost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, cost }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setGifStatus("Pris lagret.", "ok");
  } catch (err) {
    setGifStatus(`Feilet: ${err.message}`, "err");
  }
});

gifFileInput.addEventListener("change", () => {
  gifFileLabel.textContent = gifFileInput.files[0]?.name ?? t("admin.choose_gif");
});

gifForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = gifFileInput.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append("file", f);
  setGifStatus("Laster opp…");
  try {
    const r = await fetch("/admin/gifs", { method: "POST", body: fd });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setGifStatus("Lastet opp.", "ok");
    gifFileInput.value = "";
    gifFileLabel.textContent = t("admin.choose_gif");
    refreshGifs();
  } catch (err) {
    setGifStatus(`Feilet: ${err.message}`, "err");
  }
});

refreshGifs();

// --- Videos (FRITID/VIDEO) ---

const videoLibrary    = document.getElementById("videos-library");
const videoForm       = document.getElementById("video-upload-form");
const videoFileInput  = document.getElementById("video-file");
const videoFileLabel  = document.getElementById("video-file-label");
const videoStatus     = document.getElementById("video-status");

function setVideoStatus(text, kind = "") {
  videoStatus.textContent = text;
  videoStatus.className = kind;
}

async function refreshVideos() {
  try {
    const r = await fetch("/api/videos", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const items = await r.json();
    if (items.length === 0) {
      videoLibrary.innerHTML = `<p class="empty">${t("video.empty")}</p>`;
      return;
    }
    videoLibrary.innerHTML = items.map((v) => {
      const thumb = v.poster_url
        ? `<img src="${v.poster_url}" alt="">`
        : `<video src="${v.url}#t=0.5" preload="metadata" muted playsinline></video>`;
      return `
        <div class="bg-card" data-id="${v.id}">
          <div class="thumb">${thumb}</div>
          <div class="actions">
            <button class="delete" data-action="video-delete" aria-label="Slett">×</button>
          </div>
        </div>`;
    }).join("");
  } catch (err) {
    videoLibrary.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

videoLibrary.addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-action="video-delete"]');
  if (!btn) return;
  const card = e.target.closest("[data-id]");
  const id = card?.dataset.id;
  if (!id) return;
  if (!confirm("Slette denne videoen?")) return;
  try {
    const r = await fetch("/admin/videos/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    refreshVideos();
  } catch (err) {
    setVideoStatus(`Feilet: ${err.message}`, "err");
  }
});

videoFileInput.addEventListener("change", () => {
  videoFileLabel.textContent = videoFileInput.files[0]?.name ?? t("admin.choose_video");
});

videoForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = videoFileInput.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append("file", f);
  setVideoStatus("Laster opp…");
  try {
    const r = await fetch("/admin/videos", { method: "POST", body: fd });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setVideoStatus("Lastet opp.", "ok");
    videoFileInput.value = "";
    videoFileLabel.textContent = t("admin.choose_video");
    refreshVideos();
  } catch (err) {
    setVideoStatus(`Feilet: ${err.message}`, "err");
  }
});

refreshVideos();

// --- App config (heading + difficulty) ---

const headingForm    = document.getElementById("heading-form");
const headingInput   = document.getElementById("heading-input");
const showLogoToggle = document.getElementById("show-logo-toggle");
const showHeadToggle = document.getElementById("show-heading-toggle");
const levelButtons   = document.getElementById("level-buttons");
const genderButtons  = document.getElementById("gender-buttons");
const adminLangSelect = document.getElementById("admin-lang-select");
const kioskLangSelect = document.getElementById("kiosk-lang-select");
const configStatus   = document.getElementById("config-status");

const LEVEL_OPTIONS = [
  { id: "easy",   labelKey: "admin.level.easy" },
  { id: "medium", labelKey: "admin.level.medium" },
  { id: "hard",   labelKey: "admin.level.hard" },
];

const GENDER_OPTIONS = [
  { id: "female", labelKey: "admin.gender.female" },
  { id: "male",   labelKey: "admin.gender.male" },
];

const LANG_OPTIONS = [
  { id: "no", labelKey: "admin.lang.no" },
  { id: "en", labelKey: "admin.lang.en" },
  { id: "ua", labelKey: "admin.lang.ua" },
];

function renderConfigButtons() {
  levelButtons.innerHTML = LEVEL_OPTIONS.map((n) =>
    `<button type="button" class="level-btn ${n.id} mdc-button mdc-button--raised" data-level="${n.id}">
      <span class="mdc-button__ripple"></span>
      <span class="mdc-button__label">${t(n.labelKey)}</span>
     </button>`
  ).join("");
  genderButtons.innerHTML = GENDER_OPTIONS.map((g) =>
    `<button type="button" class="gender-btn ${g.id} mdc-button mdc-button--raised" data-gender="${g.id}">
      <span class="mdc-button__ripple"></span>
      <span class="mdc-button__label">${t(g.labelKey)}</span>
     </button>`
  ).join("");
  for (const sel of [adminLangSelect, kioskLangSelect]) {
    sel.innerHTML = LANG_OPTIONS.map((l) =>
      `<option value="${l.id}">${t(l.labelKey)}</option>`
    ).join("");
  }
  if (typeof mdc !== "undefined") {
    levelButtons.querySelectorAll(".mdc-button").forEach((b) => mdc.ripple.MDCRipple.attachTo(b));
    genderButtons.querySelectorAll(".mdc-button").forEach((b) => mdc.ripple.MDCRipple.attachTo(b));
  }
}

renderConfigButtons();
window.addEventListener("i18n:change", renderConfigButtons);

function setConfigStatus(text, kind = "") {
  configStatus.textContent = text;
  configStatus.className = kind;
}

async function loadAppConfig() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const cfg = await r.json();
    headingInput.value = cfg.heading || "";
    // Float the MDC label up if there's a value (otherwise it overlaps the text).
    headingInput.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelectorAll(".level-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.level === cfg.level)
    );
    document.querySelectorAll(".gender-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.gender === cfg.gender)
    );
    if (cfg.admin_lang) adminLangSelect.value = cfg.admin_lang;
    if (cfg.kiosk_lang) kioskLangSelect.value = cfg.kiosk_lang;
    if (showLogoMd) showLogoMd.selected = cfg.show_logo !== false;
    if (showHeadMd) showHeadMd.selected = cfg.show_heading !== false;
  } catch (err) {
    setConfigStatus(`Kunne ikke laste innstillinger: ${err.message}`, "err");
  }
}

headingForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const h = headingInput.value.trim();
  if (!h) return;
  setConfigStatus("Lagrer overskrift…");
  try {
    const r = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ heading: h }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setConfigStatus("Overskrift lagret.", "ok");
    loadAppConfig();
  } catch (err) {
    setConfigStatus(`Feilet: ${err.message}`, "err");
  }
});

levelButtons.addEventListener("click", async (e) => {
  const btn = e.target.closest(".level-btn");
  if (!btn) return;
  const v = btn.dataset.level;
  setConfigStatus(`Setter nivå til ${v.toUpperCase()}…`);
  try {
    const r = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: v }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setConfigStatus(`Nivå satt til ${v.toUpperCase()}.`, "ok");
    loadAppConfig();
  } catch (err) {
    setConfigStatus(`Feilet: ${err.message}`, "err");
  }
});

genderButtons.addEventListener("click", async (e) => {
  const btn = e.target.closest(".gender-btn");
  if (!btn) return;
  const g = btn.dataset.gender;
  setConfigStatus(`Setter kjønn til ${g.toUpperCase()}…`);
  try {
    const r = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gender: g }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setConfigStatus(`Kjønn lagret.`, "ok");
    loadAppConfig();
  } catch (err) {
    setConfigStatus(`Feilet: ${err.message}`, "err");
  }
});

async function postConfigField(field, value) {
  try {
    const r = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return true;
  } catch (err) {
    setConfigStatus(`Feilet: ${err.message}`, "err");
    return false;
  }
}

adminLangSelect.addEventListener("change", async (e) => {
  const v = e.target.value;
  if (await postConfigField("admin_lang", v)) {
    if (typeof setLocale === "function") await setLocale(v);
    setConfigStatus("OK", "ok");
    loadAppConfig();
  }
});

kioskLangSelect.addEventListener("change", async (e) => {
  const v = e.target.value;
  if (await postConfigField("kiosk_lang", v)) {
    setConfigStatus("OK", "ok");
    loadAppConfig();
  }
});

// MDC switches expose `selected` + a `change` event. Initialised below.
let showLogoMd = null;
let showHeadMd = null;
if (typeof mdc !== "undefined" && mdc.switchControl) {
  showLogoMd = mdc.switchControl.MDCSwitch.attachTo(showLogoToggle);
  showHeadMd = mdc.switchControl.MDCSwitch.attachTo(showHeadToggle);
  // MDCSwitch is a <button>; native "change" doesn't fire. The component's
  // own click handler updates .selected before ours runs (same-element
  // listeners fire in registration order, MDC was attached first).
  showLogoToggle.addEventListener("click", async () => {
    if (await postConfigField("show_logo", showLogoMd.selected)) setConfigStatus("OK", "ok");
  });
  showHeadToggle.addEventListener("click", async () => {
    if (await postConfigField("show_heading", showHeadMd.selected)) setConfigStatus("OK", "ok");
  });
} else {
  // Fallback for tests / no-MDC bootstraps: treat as plain checkboxes.
  showLogoToggle.addEventListener("change", async (e) => {
    if (await postConfigField("show_logo", e.target.checked)) setConfigStatus("OK", "ok");
  });
  showHeadToggle.addEventListener("change", async (e) => {
    if (await postConfigField("show_heading", e.target.checked)) setConfigStatus("OK", "ok");
  });
}

// Attach ripple + filled text-field behaviour to the device-section MDC bits.
if (typeof mdc !== "undefined") {
  document.querySelectorAll(".mdc-text-field").forEach((el) => mdc.textField.MDCTextField.attachTo(el));
  document.querySelectorAll(".mdc-button").forEach((el) => mdc.ripple.MDCRipple.attachTo(el));
}

loadAppConfig();

// --- Lock pattern (3-colour password) ---
// Mirrors the React admin's LockSection: three rows of seven colour
// circles each, click to pick, then Save / Clear posts to /api/config.

const LOCK_COLORS = ["red", "orange", "yellow", "green", "blue", "violet"];
const lockRowsEl   = document.getElementById("lock-rows");
const lockSaveBtn  = document.getElementById("lock-save");
const lockClearBtn = document.getElementById("lock-clear");
const lockStatusEl = document.getElementById("lock-status");
const lockCurrentEl = document.getElementById("lock-current");
let lockPickerState = [null, null, null];
let lockSaved = [];

function setLockStatus(text, kind = "") {
  if (!lockStatusEl) return;
  lockStatusEl.textContent = text;
  lockStatusEl.className = kind;
}

function renderLockRows() {
  if (!lockRowsEl) return;
  const rows = [0, 1, 2].map((row) => {
    const buttons = LOCK_COLORS.map((c) => {
      const picked = lockPickerState[row] === c;
      return `<button type="button" class="lock-color color-${c}${picked ? " picked" : ""}" data-row="${row}" data-color="${c}" aria-label="${c}"></button>`;
    }).join("");
    return `<div class="lock-row"><span class="lock-row-label">${row + 1}</span>${buttons}</div>`;
  }).join("");
  lockRowsEl.innerHTML = rows;
}

function renderLockCurrent() {
  if (!lockCurrentEl) return;
  if (lockSaved.length === 3) {
    lockCurrentEl.innerHTML = `Aktiv: ${lockSaved.map((c) =>
      `<span class="lock-dot color-${c}"></span>`).join("")}`;
  } else {
    lockCurrentEl.textContent = "Ingen lås satt.";
  }
}

function refreshLockButtons() {
  if (lockSaveBtn) lockSaveBtn.disabled = lockPickerState.some((c) => !c);
  if (lockClearBtn) lockClearBtn.disabled = lockSaved.length === 0;
}

async function loadLockPattern() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const cfg = await r.json();
    const lp = Array.isArray(cfg.lock_pattern) ? cfg.lock_pattern : [];
    lockSaved = lp.slice();
    lockPickerState = [lp[0] || null, lp[1] || null, lp[2] || null];
    renderLockRows();
    renderLockCurrent();
    refreshLockButtons();
  } catch (err) {
    setLockStatus(`Feilet: ${err.message}`, "err");
  }
}

if (lockRowsEl) {
  lockRowsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".lock-color");
    if (!btn) return;
    const row = Number(btn.dataset.row);
    const color = btn.dataset.color;
    if (!Number.isFinite(row) || !LOCK_COLORS.includes(color)) return;
    lockPickerState[row] = color;
    renderLockRows();
    refreshLockButtons();
  });
}

if (lockSaveBtn) {
  lockSaveBtn.addEventListener("click", async () => {
    if (lockPickerState.some((c) => !c)) {
      setLockStatus("Velg 3 farger først.", "err");
      return;
    }
    setLockStatus("Lagrer…");
    const ok = await postConfigField("lock_pattern", lockPickerState.slice());
    if (ok) {
      setLockStatus("Lagret.", "ok");
      await loadLockPattern();
    }
  });
}

if (lockClearBtn) {
  lockClearBtn.addEventListener("click", async () => {
    setLockStatus("Fjerner lås…");
    const ok = await postConfigField("lock_pattern", []);
    if (ok) {
      setLockStatus("Lås fjernet.", "ok");
      await loadLockPattern();
    }
  });
}

loadLockPattern();

// --- Activity timer (budget + extension options + 6-colour pattern) ---

const TIME_PATTERN_DEFAULT = ["red", "green", "blue", "blue", "green", "red"];
const timeBudgetForm   = document.getElementById("time-budget-form");
const timeBudgetInput  = document.getElementById("time-budget-input");
const timeOptionsForm  = document.getElementById("time-options-form");
const timeOptInputs    = [
  document.getElementById("time-opt-1"),
  document.getElementById("time-opt-2"),
  document.getElementById("time-opt-3"),
];
const timePatternRowsEl   = document.getElementById("time-pattern-rows");
const timePatternSaveBtn  = document.getElementById("time-pattern-save");
const timePatternResetBtn = document.getElementById("time-pattern-reset");
const timePatternCurrentEl = document.getElementById("time-pattern-current");
const timeStatusEl    = document.getElementById("time-status");
let timePatternState = TIME_PATTERN_DEFAULT.slice();
let timePatternSaved = TIME_PATTERN_DEFAULT.slice();

function setTimeStatus(text, kind = "") {
  if (!timeStatusEl) return;
  timeStatusEl.textContent = text;
  timeStatusEl.className = kind;
}

function renderTimePatternRows() {
  if (!timePatternRowsEl) return;
  const rows = [0, 1, 2, 3, 4, 5].map((row) => {
    const buttons = LOCK_COLORS.map((c) => {
      const picked = timePatternState[row] === c;
      return `<button type="button" class="lock-color color-${c}${picked ? " picked" : ""}" data-row="${row}" data-color="${c}" aria-label="${c}"></button>`;
    }).join("");
    return `<div class="lock-row"><span class="lock-row-label">${row + 1}</span>${buttons}</div>`;
  }).join("");
  timePatternRowsEl.innerHTML = rows;
}

function renderTimePatternCurrent() {
  if (!timePatternCurrentEl) return;
  if (timePatternSaved.length === 6) {
    timePatternCurrentEl.innerHTML = `Aktiv: ${timePatternSaved.map((c) =>
      `<span class="lock-dot color-${c}"></span>`).join("")}`;
  } else {
    timePatternCurrentEl.textContent = "Ingen fargekode satt.";
  }
}

async function loadTimeSettings() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const cfg = await r.json();
    if (timeBudgetInput) timeBudgetInput.value = Number(cfg.time_budget_minutes ?? 15);
    const opts = Array.isArray(cfg.time_extension_options) ? cfg.time_extension_options : [10, 15, 20];
    timeOptInputs.forEach((inp, i) => { if (inp) inp.value = Number(opts[i] ?? 0); });
    const pat = Array.isArray(cfg.time_extension_pattern) && cfg.time_extension_pattern.length === 6
      ? cfg.time_extension_pattern
      : TIME_PATTERN_DEFAULT;
    timePatternSaved = pat.slice();
    timePatternState = pat.slice();
    renderTimePatternRows();
    renderTimePatternCurrent();
  } catch (err) {
    setTimeStatus(`Feilet: ${err.message}`, "err");
  }
}

if (timeBudgetForm) {
  timeBudgetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const m = parseInt(timeBudgetInput.value, 10);
    if (!Number.isFinite(m) || m < 0 || m > 720) {
      setTimeStatus("Ugyldig budsjett (0-720 minutter).", "err");
      return;
    }
    setTimeStatus("Lagrer…");
    const ok = await postConfigField("time_budget_minutes", m);
    if (ok) setTimeStatus("Budsjett lagret.", "ok");
  });
}

if (timeOptionsForm) {
  timeOptionsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const vals = timeOptInputs.map((inp) => parseInt(inp.value, 10));
    if (vals.some((v) => !Number.isFinite(v) || v < 1 || v > 120)) {
      setTimeStatus("Hvert tilleggsvalg må være 1-120 minutter.", "err");
      return;
    }
    setTimeStatus("Lagrer…");
    const ok = await postConfigField("time_extension_options", vals);
    if (ok) setTimeStatus("Tilleggsvalg lagret.", "ok");
  });
}

if (timePatternRowsEl) {
  timePatternRowsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".lock-color");
    if (!btn) return;
    const row = Number(btn.dataset.row);
    const color = btn.dataset.color;
    if (!Number.isFinite(row) || !LOCK_COLORS.includes(color)) return;
    timePatternState[row] = color;
    renderTimePatternRows();
  });
}

if (timePatternSaveBtn) {
  timePatternSaveBtn.addEventListener("click", async () => {
    if (timePatternState.length !== 6 || timePatternState.some((c) => !LOCK_COLORS.includes(c))) {
      setTimeStatus("Velg 6 farger.", "err");
      return;
    }
    setTimeStatus("Lagrer…");
    const ok = await postConfigField("time_extension_pattern", timePatternState.slice());
    if (ok) {
      setTimeStatus("Fargekode lagret.", "ok");
      await loadTimeSettings();
    }
  });
}

if (timePatternResetBtn) {
  timePatternResetBtn.addEventListener("click", () => {
    timePatternState = TIME_PATTERN_DEFAULT.slice();
    renderTimePatternRows();
    setTimeStatus("Standard valgt — trykk Lagre for å bekrefte.", "");
  });
}

loadTimeSettings();

// --- Calendar (iCal import / export / clear) ---

const calInfo       = document.getElementById("calendar-info");
const calStatus     = document.getElementById("calendar-status");
const calForm       = document.getElementById("calendar-import");
const calFile       = document.getElementById("calendar-file");
const calFileLabel  = document.getElementById("calendar-file-label");
const calClear      = document.getElementById("calendar-clear");

function setCalStatus(text, kind = "") {
  calStatus.textContent = text;
  calStatus.className = kind;
}

async function refreshCalendarInfo() {
  try {
    const r = await fetch("/api/calendar", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data.ical_available === false) {
      calInfo.textContent = "iCalendar-biblioteket mangler på serveren — import/eksport ikke tilgjengelig.";
    } else {
      calInfo.textContent = `${data.count} avtale${data.count === 1 ? "" : "r"} lagret.`;
    }
  } catch (err) {
    calInfo.textContent = `Kunne ikke laste kalenderinfo: ${err.message}`;
  }
}

calFile.addEventListener("change", () => {
  calFileLabel.textContent = calFile.files[0]?.name ?? "Velg .ics-fil…";
});

calForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = calFile.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append("file", f);
  setCalStatus("Importerer…");
  try {
    const r = await fetch("/api/calendar/import", { method: "POST", body: fd });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(t || `HTTP ${r.status}`);
    }
    const data = await r.json();
    setCalStatus(`La til ${data.added}, hoppet over ${data.skipped}. Totalt nå: ${data.total}.`, "ok");
    calFile.value = "";
    calFileLabel.textContent = "Velg .ics-fil…";
    refreshCalendarInfo();
  } catch (err) {
    setCalStatus(`Feilet: ${err.message}`, "err");
  }
});

calClear.addEventListener("click", async () => {
  if (!confirm("Tømme hele kalenderen? Dette kan ikke angres.")) return;
  setCalStatus("Tømmer…");
  try {
    const r = await fetch("/api/calendar", { method: "DELETE" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setCalStatus("Kalender tømt.", "ok");
    refreshCalendarInfo();
  } catch (err) {
    setCalStatus(`Feilet: ${err.message}`, "err");
  }
});

refreshCalendarInfo();

// --- Stories admin ---

const storyList         = document.getElementById("story-list");
const storyStatus       = document.getElementById("story-status");
const storyEditor       = document.getElementById("story-editor");
const editorHeading     = document.getElementById("editor-heading");
const editorTitleInput  = document.getElementById("editor-title-input");
const editorPages       = document.getElementById("editor-pages");
const newStoryBtn       = document.getElementById("new-story");
const editorAddPageBtn  = document.getElementById("editor-add-page");
const editorSaveBtn     = document.getElementById("editor-save");
const editorCancelBtn   = document.getElementById("editor-cancel");
const saveActiveBtn     = document.getElementById("save-active");
const activeSlots       = document.querySelectorAll("[data-slot]");

let storiesIndex = [];
let editingStoryId = null;
let editingPages = [];

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function setStoryStatus(text, kind = "") {
  storyStatus.textContent = text;
  storyStatus.className = kind;
}

async function refreshStories() {
  try {
    const [allR, activeR] = await Promise.all([
      fetch("/api/stories",        { cache: "no-store" }),
      fetch("/api/stories/active", { cache: "no-store" }),
    ]);
    if (!allR.ok || !activeR.ok) throw new Error("HTTP error");
    storiesIndex = await allR.json();
    const activeIds = (await activeR.json()).map((s) => s.id);
    renderStoryList();
    renderActiveSlots(activeIds);
  } catch (err) {
    storyList.innerHTML = `<p class="empty">Kunne ikke laste: ${err.message}</p>`;
  }
}

function renderStoryList() {
  if (!storiesIndex.length) {
    storyList.innerHTML = `<p class="empty">Ingen historier enda.</p>`;
    return;
  }
  storyList.innerHTML = storiesIndex.map((s) => `
    <div class="story-row" data-id="${s.id}">
      <span class="title">${escapeAttr(s.title)}</span>
      <span class="meta">${s.page_count} ${s.page_count === 1 ? "side" : "sider"}</span>
      <button class="edit"   data-action="edit">Rediger</button>
      <button class="delete" data-action="delete">Slett</button>
    </div>`).join("");
}

function renderActiveSlots(activeIds) {
  activeSlots.forEach((select, i) => {
    const opts = ['<option value="">— Ingen —</option>'].concat(
      storiesIndex.map((s) =>
        `<option value="${s.id}" ${activeIds[i] === s.id ? "selected" : ""}>${escapeAttr(s.title)}</option>`
      )
    );
    select.innerHTML = opts.join("");
  });
}

storyList.addEventListener("click", (e) => {
  const row = e.target.closest(".story-row");
  if (!row) return;
  const id = row.dataset.id;
  const action = e.target.closest("[data-action]")?.dataset?.action;
  if (action === "edit")   return openEditor(id);
  if (action === "delete") return deleteStoryAdmin(id);
});

async function openEditor(id) {
  if (id) {
    try {
      const r = await fetch(`/api/stories/${id}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const s = await r.json();
      editingStoryId = s.id;
      editorHeading.textContent = "Rediger historie";
      editorTitleInput.value = s.title || "";
      editingPages = (s.pages || []).map((p) => ({
        text:      p.text || "",
        image:     p.image || null,
        image_url: p.image_url || null,
      }));
    } catch (err) {
      setStoryStatus(`Feilet: ${err.message}`, "err");
      return;
    }
  } else {
    editingStoryId = null;
    editorHeading.textContent = "Ny historie";
    editorTitleInput.value = "";
    editingPages = [{ text: "", image: null, image_url: null }];
  }
  renderEditorPages();
  storyEditor.showModal();
}

function renderEditorPages() {
  editorPages.innerHTML = editingPages.map((p, i) => `
    <div class="editor-page" data-idx="${i}">
      <div class="head">
        <span class="num">Side ${i + 1}</span>
        <button type="button" class="remove" data-action="remove-page">Fjern</button>
      </div>
      <textarea data-field="text" placeholder="Tekst på denne siden">${escapeAttr(p.text)}</textarea>
      <div class="img-row">
        <div class="img-thumb">${p.image_url ? `<img src="${p.image_url}" alt="">` : ""}</div>
        <label class="file-input">
          <input type="file" accept="image/*" data-action="page-img">
          <span>${p.image ? "Bytt bilde" : "Velg bilde"}</span>
        </label>
      </div>
    </div>`).join("");
}

editorPages.addEventListener("input", (e) => {
  const page = e.target.closest(".editor-page");
  if (!page) return;
  const idx = +page.dataset.idx;
  if (e.target.dataset.field === "text") editingPages[idx].text = e.target.value;
});

editorPages.addEventListener("click", (e) => {
  if (!e.target.closest("[data-action='remove-page']")) return;
  const page = e.target.closest(".editor-page");
  const idx = +page.dataset.idx;
  editingPages.splice(idx, 1);
  renderEditorPages();
});

editorPages.addEventListener("change", async (e) => {
  if (e.target.dataset.action !== "page-img") return;
  const file = e.target.files?.[0];
  if (!file) return;
  const page = e.target.closest(".editor-page");
  const idx = +page.dataset.idx;
  const fd = new FormData();
  fd.append("file", file);
  setStoryStatus("Laster opp bilde…");
  try {
    const r = await fetch("/api/stories/img", { method: "POST", body: fd });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    editingPages[idx].image = data.name;
    editingPages[idx].image_url = data.url;
    renderEditorPages();
    setStoryStatus("Bilde opplastet.", "ok");
  } catch (err) {
    setStoryStatus(`Feilet: ${err.message}`, "err");
  }
});

editorAddPageBtn.addEventListener("click", (e) => {
  e.preventDefault();
  editingPages.push({ text: "", image: null, image_url: null });
  renderEditorPages();
});

editorCancelBtn.addEventListener("click", (e) => {
  e.preventDefault();
  storyEditor.close();
});

editorSaveBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  const payload = {
    title: editorTitleInput.value.trim() || "Uten tittel",
    pages: editingPages.map((p) => ({ text: p.text, image: p.image || null })),
  };
  try {
    const url    = editingStoryId ? `/api/stories/${editingStoryId}` : "/api/stories";
    const method = editingStoryId ? "PUT" : "POST";
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    storyEditor.close();
    setStoryStatus("Lagret.", "ok");
    refreshStories();
  } catch (err) {
    setStoryStatus(`Feilet: ${err.message}`, "err");
  }
});

newStoryBtn.addEventListener("click", () => openEditor(null));

async function deleteStoryAdmin(id) {
  if (!confirm("Slette denne historien?")) return;
  try {
    const r = await fetch(`/api/stories/${id}`, { method: "DELETE" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStoryStatus("Slettet.", "ok");
    refreshStories();
  } catch (err) {
    setStoryStatus(`Feilet: ${err.message}`, "err");
  }
}

saveActiveBtn.addEventListener("click", async () => {
  const ids = Array.from(activeSlots).map((s) => s.value).filter(Boolean);
  try {
    const r = await fetch("/api/stories/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStoryStatus("Aktive historier lagret.", "ok");
    refreshStories();
  } catch (err) {
    setStoryStatus(`Feilet: ${err.message}`, "err");
  }
});

refreshStories();

// --- Trainings admin (FRITID/TRENING) — same shape as stories with media-aware pages ---

const trainingList            = document.getElementById("training-list");
const trainingStatus          = document.getElementById("training-status");
const trainingEditor          = document.getElementById("training-editor");
const trainingEditorHeading   = document.getElementById("training-editor-heading");
const trainingEditorTitle     = document.getElementById("training-editor-title-input");
const trainingEditorPages     = document.getElementById("training-editor-pages");
const newTrainingBtn          = document.getElementById("new-training");
const trainingAddPageBtn      = document.getElementById("training-editor-add-page");
const trainingSaveBtn         = document.getElementById("training-editor-save");
const trainingCancelBtn       = document.getElementById("training-editor-cancel");
const saveActiveTrainingsBtn  = document.getElementById("save-active-trainings");
const trainingActiveSlots     = document.querySelectorAll("[data-training-slot]");

let trainingsIndex = [];
let editingTrainingId = null;
let editingTrainingPages = [];

function setTrainingStatus(text, kind = "") {
  trainingStatus.textContent = text;
  trainingStatus.className = kind;
}

async function refreshTrainings() {
  try {
    const [allR, activeR] = await Promise.all([
      fetch("/api/trainings",        { cache: "no-store" }),
      fetch("/api/trainings/active", { cache: "no-store" }),
    ]);
    if (!allR.ok || !activeR.ok) throw new Error("HTTP error");
    trainingsIndex = await allR.json();
    const activeIds = (await activeR.json()).map((s) => s.id);
    renderTrainingList();
    renderTrainingActiveSlots(activeIds);
  } catch (err) {
    trainingList.innerHTML = `<p class="empty">Kunne ikke laste: ${err.message}</p>`;
  }
}

function renderTrainingList() {
  if (!trainingsIndex.length) {
    trainingList.innerHTML = `<p class="empty">${t("trening.empty")}</p>`;
    return;
  }
  trainingList.innerHTML = trainingsIndex.map((s) => `
    <div class="story-row" data-id="${s.id}">
      <span class="title">${escapeAttr(s.title)}</span>
      <span class="meta">${s.page_count} ${s.page_count === 1 ? "side" : "sider"}</span>
      <button class="edit"   data-action="edit">Rediger</button>
      <button class="delete" data-action="delete">Slett</button>
    </div>`).join("");
}

function renderTrainingActiveSlots(activeIds) {
  trainingActiveSlots.forEach((select, i) => {
    const opts = ['<option value="">— Ingen —</option>'].concat(
      trainingsIndex.map((s) =>
        `<option value="${s.id}" ${activeIds[i] === s.id ? "selected" : ""}>${escapeAttr(s.title)}</option>`
      )
    );
    select.innerHTML = opts.join("");
  });
}

trainingList.addEventListener("click", (e) => {
  const row = e.target.closest(".story-row");
  if (!row) return;
  const id = row.dataset.id;
  const action = e.target.closest("[data-action]")?.dataset?.action;
  if (action === "edit")   return openTrainingEditor(id);
  if (action === "delete") return deleteTrainingAdmin(id);
});

async function openTrainingEditor(id) {
  if (id) {
    try {
      const r = await fetch(`/api/trainings/${id}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const s = await r.json();
      editingTrainingId = s.id;
      trainingEditorHeading.textContent = t("admin.trainings.edit_title");
      trainingEditorTitle.value = s.title || "";
      editingTrainingPages = (s.pages || []).map((p) => ({
        text:       p.text || "",
        media:      p.media || null,
        media_url:  p.media_url || null,
        media_kind: p.media_kind || null,
      }));
    } catch (err) {
      setTrainingStatus(`Feilet: ${err.message}`, "err");
      return;
    }
  } else {
    editingTrainingId = null;
    trainingEditorHeading.textContent = t("admin.trainings.new");
    trainingEditorTitle.value = "";
    editingTrainingPages = [{ text: "", media: null, media_url: null, media_kind: null }];
  }
  renderTrainingEditorPages();
  trainingEditor.showModal();
}

function renderTrainingEditorPages() {
  trainingEditorPages.innerHTML = editingTrainingPages.map((p, i) => {
    let preview = "";
    if (p.media_kind === "video" && p.media_url) {
      preview = p.poster_url
        ? `<img src="${p.poster_url}" alt="">`
        : `<video src="${p.media_url}#t=0.5" preload="metadata" muted playsinline></video>`;
    } else if (p.media_url) {
      preview = `<img src="${p.media_url}" alt="">`;
    }
    return `
      <div class="editor-page" data-idx="${i}">
        <div class="head">
          <span class="num">Side ${i + 1}</span>
          <button type="button" class="remove" data-action="remove-page">Fjern</button>
        </div>
        <textarea data-field="text" placeholder="Tekst på denne siden">${escapeAttr(p.text)}</textarea>
        <div class="img-row">
          <div class="img-thumb">${preview}</div>
          <label class="file-input">
            <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" data-action="page-media">
            <span>${p.media ? "Bytt media" : t("admin.trainings.choose_media")}</span>
          </label>
        </div>
      </div>`;
  }).join("");
}

trainingEditorPages.addEventListener("input", (e) => {
  const page = e.target.closest(".editor-page");
  if (!page) return;
  const idx = +page.dataset.idx;
  if (e.target.dataset.field === "text") editingTrainingPages[idx].text = e.target.value;
});

trainingEditorPages.addEventListener("click", (e) => {
  if (!e.target.closest("[data-action='remove-page']")) return;
  const page = e.target.closest(".editor-page");
  const idx = +page.dataset.idx;
  editingTrainingPages.splice(idx, 1);
  renderTrainingEditorPages();
});

trainingEditorPages.addEventListener("change", async (e) => {
  if (e.target.dataset.action !== "page-media") return;
  const file = e.target.files?.[0];
  if (!file) return;
  const page = e.target.closest(".editor-page");
  const idx = +page.dataset.idx;
  const fd = new FormData();
  fd.append("file", file);
  setTrainingStatus("Laster opp media…");
  try {
    const r = await fetch("/api/trainings/media", { method: "POST", body: fd });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    editingTrainingPages[idx].media = data.name;
    editingTrainingPages[idx].media_url = data.url;
    editingTrainingPages[idx].media_kind = data.kind;
    editingTrainingPages[idx].poster_url = data.poster_url || null;
    renderTrainingEditorPages();
    setTrainingStatus("Media opplastet.", "ok");
  } catch (err) {
    setTrainingStatus(`Feilet: ${err.message}`, "err");
  }
});

trainingAddPageBtn.addEventListener("click", (e) => {
  e.preventDefault();
  editingTrainingPages.push({ text: "", media: null, media_url: null, media_kind: null });
  renderTrainingEditorPages();
});

trainingCancelBtn.addEventListener("click", (e) => {
  e.preventDefault();
  trainingEditor.close();
});

trainingSaveBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  const payload = {
    title: trainingEditorTitle.value.trim() || "Uten tittel",
    pages: editingTrainingPages.map((p) => ({ text: p.text, media: p.media || null })),
  };
  try {
    const url    = editingTrainingId ? `/api/trainings/${editingTrainingId}` : "/api/trainings";
    const method = editingTrainingId ? "PUT" : "POST";
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    trainingEditor.close();
    setTrainingStatus("Lagret.", "ok");
    refreshTrainings();
  } catch (err) {
    setTrainingStatus(`Feilet: ${err.message}`, "err");
  }
});

newTrainingBtn.addEventListener("click", () => openTrainingEditor(null));

async function deleteTrainingAdmin(id) {
  if (!confirm("Slette denne treningsøkten?")) return;
  try {
    const r = await fetch(`/api/trainings/${id}`, { method: "DELETE" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setTrainingStatus("Slettet.", "ok");
    refreshTrainings();
  } catch (err) {
    setTrainingStatus(`Feilet: ${err.message}`, "err");
  }
}

saveActiveTrainingsBtn.addEventListener("click", async () => {
  const ids = Array.from(trainingActiveSlots).map((s) => s.value).filter(Boolean);
  try {
    const r = await fetch("/api/trainings/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setTrainingStatus("Aktive treningsøkter lagret.", "ok");
    refreshTrainings();
  } catch (err) {
    setTrainingStatus(`Feilet: ${err.message}`, "err");
  }
});

refreshTrainings();
