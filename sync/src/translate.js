// translate.js — professional American-English translation pipeline.
// Pluggable provider. Brand names, SKUs and model numbers are NEVER translated.
// Results are cached on disk so unchanged text is not re-translated (cost + speed).
import fs from "node:fs";
import path from "node:path";
import CONFIG from "../config.js";
import log from "./logger.js";
import { sha1 } from "./util.js";

let cache = {};
function loadCache() {
  try { cache = JSON.parse(fs.readFileSync(CONFIG.translate.cacheFile, "utf8")); }
  catch { cache = {}; }
}
function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CONFIG.translate.cacheFile), { recursive: true });
    fs.writeFileSync(CONFIG.translate.cacheFile, JSON.stringify(cache));
  } catch (e) { log.warn(`translation cache not saved: ${e.message}`); }
}
loadCache();

const key = (text) => sha1(CONFIG.translate.provider + "|" + text);

// ---- providers -------------------------------------------------------------
async function translateAnthropic(text) {
  if (!CONFIG.translate.apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": CONFIG.translate.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CONFIG.translate.model,
      max_tokens: 1500,
      system:
        "You are a professional product-copy translator. Translate the user's text into clear, " +
        "professional American English suitable for an e-commerce catalog. Preserve meaning, units, " +
        "numbers and formatting (line breaks, lists). Do NOT translate or alter brand names, model " +
        "numbers, SKUs, or measurement units. Return ONLY the translated text, with no preamble.",
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content?.[0]?.text || "").trim();
}

async function translateOne(text) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  if (CONFIG.translate.provider === "none") return t; // passthrough (no key needed)
  const k = key(t);
  if (cache[k]) return cache[k];
  let out = t;
  try {
    if (CONFIG.translate.provider === "anthropic") out = await translateAnthropic(t);
    else { log.warn(`unknown TRANSLATE_PROVIDER '${CONFIG.translate.provider}', passing through`); out = t; }
    cache[k] = out;
    log.count.translated++;
  } catch (e) {
    log.warn(`translation failed (kept original): ${e.message}`);
    out = t; // never lose data on translation failure
  }
  return out;
}

// Translate the configured fields on a product, in place, respecting types.
export async function translateProduct(p) {
  for (const field of CONFIG.translate.fields) {
    const v = p[field];
    if (Array.isArray(v)) {
      p[field] = await Promise.all(v.map((x) => translateOne(x)));
    } else if (typeof v === "string" && v) {
      p[field] = await translateOne(v);
    }
  }
  // brand, sku, modelNumber, variations are intentionally left untranslated.
  return p;
}

export function persistTranslationCache() { saveCache(); }
