import { CONFIG } from "./config.js";
import { supabase } from "./supabase.js";

// Script-based guess of the language a text was written in, stored as
// original_language. Returns null when the script doesn't tell us (e.g. Latin
// text could be English, French, Spanish…) — a translation API should fill it.
export function detectLanguage(text = "") {
  if (/[가-힯]/.test(text)) return "ko";
  if (/[぀-ヿ]/.test(text)) return "ja";
  if (/[一-鿿]/.test(text)) return "zh";
  if (/[฀-๿]/.test(text)) return "th";
  if (/[Ѐ-ӿ]/.test(text)) return "ru";
  if (/[؀-ۿ]/.test(text)) return "ar";
  if (/[֐-׿]/.test(text)) return "he";
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  return null;
}

export function viewerLanguage() {
  return (navigator.language || "en").slice(0, 2).toLowerCase();
}

export const isTranslationConfigured = () => Boolean(CONFIG.TRANSLATION_ENDPOINT);

const cache = new Map();

/**
 * Translates text into the viewer's language.
 * Returns null while no translation API is connected — never a fake result.
 */
export async function translateText(text, targetLanguage = viewerLanguage()) {
  // TODO: Connect translation API
  if (!isTranslationConfigured()) return null;

  const key = `${targetLanguage}:${text}`;
  if (cache.has(key)) return cache.get(key);

  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(CONFIG.TRANSLATION_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify({ text, target: targetLanguage }),
  });
  if (!res.ok) throw new Error("Translation failed");
  const { translatedText } = await res.json();
  cache.set(key, translatedText);
  return translatedText;
}

/** Segmented Original / Translated control. */
export function translationToggleHtml() {
  return `
    <div class="lang-toggle" role="group" aria-label="Translation">
      <button type="button" class="lang-toggle__btn" data-lang-mode="translated">Translated</button>
      <button type="button" class="lang-toggle__btn is-active" data-lang-mode="original">Original</button>
    </div>`;
}

/**
 * Wires one toggle. `textEl` must hold the original in data-original.
 */
export async function handleTranslationToggle(button, textEl, onUnavailable) {
  const group = button.closest(".lang-toggle");
  const setActive = (mode) =>
    group.querySelectorAll("[data-lang-mode]").forEach((b) => b.classList.toggle("is-active", b.dataset.langMode === mode));

  const original = textEl.dataset.original ?? "";
  if (button.dataset.langMode === "original") {
    textEl.textContent = original;
    setActive("original");
    return;
  }

  setActive("translated");
  group.classList.add("is-loading");
  try {
    const translated = await translateText(original);
    if (translated == null) {
      setActive("original");
      onUnavailable?.();
      return;
    }
    textEl.textContent = translated;
  } catch {
    setActive("original");
    textEl.textContent = original;
    onUnavailable?.("Translation failed. Please try again.");
  } finally {
    group.classList.remove("is-loading");
  }
}
