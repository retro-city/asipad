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
