const form = document.getElementById("upload-form");
const fileInput = document.getElementById("file");
const fileLabel = document.getElementById("file-label");
const status = document.getElementById("status");
const preview = document.getElementById("preview");
const noBg = document.getElementById("no-bg");
const clearBtn = document.getElementById("clear-bg");

function setStatus(text, kind = "") {
  status.textContent = text;
  status.className = kind;
}

function refreshPreview(version) {
  const v = version ?? Date.now();
  const probe = new Image();
  probe.onload = () => {
    preview.src = probe.src;
    preview.hidden = false;
    noBg.hidden = true;
  };
  probe.onerror = () => {
    preview.hidden = true;
    noBg.hidden = false;
  };
  probe.src = `/background?v=${v}`;
}

refreshPreview();

fileInput.addEventListener("change", () => {
  const f = fileInput.files[0];
  fileLabel.textContent = f ? f.name : "Velg bilde…";
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
    const data = await r.json();
    setStatus("Lastet opp.", "ok");
    refreshPreview(data.version);
    fileInput.value = "";
    fileLabel.textContent = "Velg bilde…";
  } catch (err) {
    setStatus(`Feilet: ${err.message}`, "err");
  }
});

clearBtn.addEventListener("click", async () => {
  if (!confirm("Fjerne bakgrunn?")) return;
  setStatus("Fjerner…");
  try {
    const r = await fetch("/admin/background/clear", { method: "POST" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus("Fjernet.", "ok");
    refreshPreview();
  } catch (err) {
    setStatus(`Feilet: ${err.message}`, "err");
  }
});
