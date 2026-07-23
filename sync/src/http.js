// http.js — polite fetch with retry/backoff, global rate limiting, robots.txt.
import CONFIG from "../config.js";
import log from "./logger.js";

let lastRequestAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- global rate limiter: guarantees >= minDelayMs between any two requests --
async function throttle() {
  const wait = CONFIG.crawl.minDelayMs - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

// --- minimal robots.txt handling (per user-agent, path prefix rules) --------
// States: rules object | 'ALLOW_ALL' (no robots / 404) | 'BLOCKED' (cannot
// confirm permission → 5xx/403/429/network error). We FAIL CLOSED on BLOCKED:
// a system restricted to authorized access must not crawl when robots.txt
// cannot be retrieved or the source is access-restricted. (Requirements 13/14.)
let robotsRules = null;
export let robotsReason = "";
async function loadRobots() {
  if (robotsRules !== null) return robotsRules;
  if (!CONFIG.source.respectRobots) { robotsRules = "ALLOW_ALL"; robotsReason = "robots ignored (IGNORE_ROBOTS)"; return robotsRules; }
  try {
    const url = new URL("/robots.txt", CONFIG.source.baseUrl).toString();
    const res = await fetch(url, { headers: { "User-Agent": CONFIG.source.userAgent } });
    if (res.status === 404) { robotsRules = "ALLOW_ALL"; robotsReason = "no robots.txt (404) → allowed"; return robotsRules; }
    if (!res.ok) { robotsRules = "BLOCKED"; robotsReason = `robots.txt fetch HTTP ${res.status} → cannot confirm permission`; return robotsRules; }
    const txt = await res.text();
    const rules = { disallow: [], allow: [] };
    let applies = false;
    for (const raw of txt.split("\n")) {
      const l = raw.split("#")[0].trim(); if (!l) continue;
      const [k, ...rest] = l.split(":"); const key = k.trim().toLowerCase();
      const val = rest.join(":").trim();
      if (key === "user-agent") applies = val === "*" || CONFIG.source.userAgent.toLowerCase().includes(val.toLowerCase());
      else if (applies && key === "disallow" && val) rules.disallow.push(val);
      else if (applies && key === "allow" && val) rules.allow.push(val);
    }
    robotsRules = rules;
    robotsReason = rules.disallow.length ? `robots.txt disallow rules: ${rules.disallow.join(", ")}` : "robots.txt permits";
  } catch (e) { robotsRules = "BLOCKED"; robotsReason = `robots.txt unreachable (${e.message}) → cannot confirm permission`; }
  return robotsRules;
}

export async function robotsAllows(urlStr) {
  const rules = await loadRobots();
  if (rules === "ALLOW_ALL") return true;
  if (rules === "BLOCKED") return false;                 // fail closed
  const p = new URL(urlStr).pathname;
  const longest = (arr) => arr.filter((r) => p.startsWith(r)).sort((a, b) => b.length - a.length)[0];
  const dis = longest(rules.disallow), alw = longest(rules.allow);
  if (dis && (!alw || alw.length < dis.length)) return false;
  return true;
}

// expose the human-readable reason for the preflight abort message
export async function robotsStatus() { await loadRobots(); return robotsReason; }

// --- fetch text/buffer with retry + exponential backoff ---------------------
async function withRetry(fn, label) {
  let attempt = 0, delay = 1000;
  for (;;) {
    try { return await fn(); }
    catch (e) {
      attempt++;
      if (attempt > CONFIG.crawl.maxRetries) throw e;
      log.warn(`retry ${attempt}/${CONFIG.crawl.maxRetries} ${label}: ${e.message} (waiting ${delay}ms)`);
      await sleep(delay); delay = Math.min(delay * 2, 16000);
    }
  }
}

export async function fetchHtml(urlStr) {
  if (!(await robotsAllows(urlStr))) { const e = new Error("blocked by robots.txt"); e.robots = true; throw e; }
  return withRetry(async () => {
    await throttle();
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), CONFIG.crawl.timeoutMs);
    try {
      const res = await fetch(urlStr, {
        headers: {
          "User-Agent": CONFIG.source.userAgent,
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: ctrl.signal,
        redirect: "follow",
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
      return await res.text();
    } finally { clearTimeout(to); }
  }, urlStr);
}

export async function fetchBuffer(urlStr) {
  return withRetry(async () => {
    await throttle();
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), CONFIG.crawl.timeoutMs);
    try {
      const res = await fetch(urlStr, { headers: { "User-Agent": CONFIG.source.userAgent }, signal: ctrl.signal });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
      const buf = Buffer.from(await res.arrayBuffer());
      return { buffer: buf, contentType: res.headers.get("content-type") || "" };
    } finally { clearTimeout(to); }
  }, urlStr);
}

// --- tiny concurrency limiter ------------------------------------------------
export function limiter(concurrency) {
  let active = 0; const queue = [];
  const next = () => { active--; if (queue.length) queue.shift()(); };
  return (fn) => new Promise((resolve, reject) => {
    const run = () => { active++; Promise.resolve().then(fn).then((v) => { resolve(v); next(); }, (e) => { reject(e); next(); }); };
    if (active < concurrency) run(); else queue.push(run);
  });
}

export { sleep };
