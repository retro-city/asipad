// Minimal i18n: flat-key JSON dictionaries, {var} interpolation, fallback locale.
//
// Usage:
//   t("page.calendar")              → "Kalender" (in current locale)
//   t("page.X", { count: 3 })       → interpolates {count}
//   await setLocale("ua")           → fetch /locales/ua.json and re-translate static [data-i18n] elements
//
// The server inlines `window.__I18N__ = { locale, dict }` into the HTML so the
// initial render has translations available without an extra round-trip. Calls
// to setLocale() fetch the requested locale lazily and cache it.

const I18N = {
  locale: (typeof window !== "undefined" && window.__I18N__?.locale) || "no",
  fallback: "no",
  dicts: {},
};

if (typeof window !== "undefined" && window.__I18N__?.dict) {
  I18N.dicts[I18N.locale] = window.__I18N__.dict;
}

function t(key, vars) {
  let s = (I18N.dicts[I18N.locale] || {})[key];
  if (s == null) s = (I18N.dicts[I18N.fallback] || {})[key];
  if (s == null) s = key;
  if (vars) for (const k in vars) s = s.replaceAll("{" + k + "}", vars[k]);
  return s;
}

async function setLocale(code) {
  if (!I18N.dicts[code]) {
    try {
      const r = await fetch("/locales/" + code + ".json", { cache: "no-cache" });
      if (r.ok) I18N.dicts[code] = await r.json();
    } catch (_) { /* keep fallback */ }
  }
  I18N.locale = code;
  applyTranslations();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("i18n:change", { detail: { locale: code } }));
  }
}

function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
}

if (typeof window !== "undefined") {
  window.I18N = I18N;
  window.t = t;
  window.setLocale = setLocale;
  window.applyTranslations = applyTranslations;
  // Translate any [data-i18n] elements already in the DOM.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => applyTranslations());
  } else {
    applyTranslations();
  }
}
