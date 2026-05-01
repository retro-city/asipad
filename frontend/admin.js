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
      <div class="bg-card ${b.current ? "current" : ""}" data-id="${b.id}">
        <button class="thumb" data-action="use" aria-label="${b.current ? "Aktiv bakgrunn" : "Sett som aktiv"}">
          <img src="${b.url}" alt="">
          ${b.current ? `<span class="badge">Aktiv</span>` : ""}
        </button>
        <div class="actions">
          ${b.current
            ? `<button class="use" disabled>Aktiv</button>`
            : `<button class="use" data-action="use">Bruk</button>`}
          <button class="delete" data-action="delete" aria-label="Slett">×</button>
        </div>
      </div>
    `).join("");
  } catch (err) {
    library.innerHTML = `<p class="error">Kunne ikke laste bakgrunner: ${err.message}</p>`;
  }
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

// --- App config (heading + difficulty) ---

const headingForm   = document.getElementById("heading-form");
const headingInput  = document.getElementById("heading-input");
const nivaaButtons  = document.getElementById("nivaa-buttons");
const configStatus  = document.getElementById("config-status");

const NIVAA_OPTIONS = [
  { id: "lett",      label: "Lett" },
  { id: "medium",    label: "Medium" },
  { id: "vanskelig", label: "Vanskelig" },
];

nivaaButtons.innerHTML = NIVAA_OPTIONS.map((n) =>
  `<button type="button" class="nivaa-btn ${n.id}" data-nivaa="${n.id}">${n.label}</button>`
).join("");

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
    document.querySelectorAll(".nivaa-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.nivaa === cfg.nivaa)
    );
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

nivaaButtons.addEventListener("click", async (e) => {
  const btn = e.target.closest(".nivaa-btn");
  if (!btn) return;
  const v = btn.dataset.nivaa;
  setConfigStatus(`Setter nivå til ${v.toUpperCase()}…`);
  try {
    const r = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nivaa: v }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setConfigStatus(`Nivå satt til ${v.toUpperCase()}.`, "ok");
    loadAppConfig();
  } catch (err) {
    setConfigStatus(`Feilet: ${err.message}`, "err");
  }
});

loadAppConfig();

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
