// http.js — polite HTTP with retry/backoff, rate limiting, robots.txt, and a
// curl transport fallback (resilient to flaky native-fetch/proxy DNS; inert
// where native fetch works, e.g. GitHub Actions runners).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import CONFIG from "../config.js";
import log from "./logger.js";

const execFileP = promisify(execFile);
let lastRequestAt = 0;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
  const wait = CONFIG.crawl.minDelayMs - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

// ---- low level: native fetch, then curl fallback ---------------------------
async function nativeGet(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), CONFIG.crawl.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": CONFIG.source.userAgent, "Accept-Language": "en-US,en;q=0.9" },
      signal: ctrl.signal, redirect: "follow",
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buffer, contentType: res.headers.get("content-type") || "", via: "fetch" };
  } finally { clearTimeout(to); }
}

async function curlGet(url) {
  const stamp = path.join(os.tmpdir(), "sync-" + crypto.randomBytes(6).toString("hex"));
  const hdr = stamp + ".h", body = stamp + ".b";
  try {
    await execFileP("curl", [
      "-sS", "-L", "--max-time", String(Math.ceil(CONFIG.crawl.timeoutMs / 1000)),
      "-A", CONFIG.source.userAgent, "-D", hdr, "-o", body, url,
    ], { maxBuffer: 64 * 1024 * 1024 });
    const headers = fs.readFileSync(hdr, "utf8");
    const lastBlock = headers.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//m.test(b)).pop() || headers;
    const status = parseInt((/HTTP\/[\d.]+ (\d+)/.exec(lastBlock) || [])[1] || "0", 10);
    const contentType = (/content-type:\s*([^\r\n]+)/i.exec(lastBlock) || [])[1] || "";
    return { status, buffer: fs.readFileSync(body), contentType, via: "curl" };
  } finally { try { fs.rmSync(hdr, { force: true }); fs.rmSync(body, { force: true }); } catch { /* noop */ } }
}

// try native, fall back to curl on network error or 5xx/429. Once native fetch
// fails for a host (e.g. proxy DNS 503), skip native for that host thereafter
// and go straight to curl — avoids wasting a native round-trip per request.
const nativeBroken = new Set();
async function curlWithRetry(url) {
  let lastErr = "";
  for (let i = 1; i <= 3; i++) {
    try { const r = await curlGet(url); if (r.status === 429 || r.status >= 500) { lastErr = `HTTP ${r.status}`; } else return r; }
    catch (e) { lastErr = e.message; }
    await sleep(600 * i);
  }
  throw new Error(`curl failed: ${lastErr}`);
}
async function rawGet(url) {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  if (!nativeBroken.has(host)) {
    try {
      const r = await nativeGet(url);
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) {
      nativeBroken.add(host); // this host is unreliable via native fetch → use curl
    }
  }
  return curlWithRetry(url);
}

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

// ---- charset-aware decode (these supplier sites are gb2312) -----------------
function decodeBody(buf, contentType) {
  let cs = (/charset=([\w-]+)/i.exec(contentType || "")?.[1] || "").toLowerCase();
  if (!cs) {
    const head = buf.subarray(0, 2048).toString("latin1");
    cs = (/charset=["']?([\w-]+)/i.exec(head)?.[1] || "utf-8").toLowerCase();
  }
  if (cs === "gb2312" || cs === "gbk") cs = "gb18030";
  try { return new TextDecoder(cs).decode(buf); }
  catch { return new TextDecoder("utf-8").decode(buf); }
}

// ---- robots.txt — PER HOST (multi-source safe). FAIL CLOSED when unconfirmable.
const robotsCache = new Map();   // origin -> rules | 'ALLOW_ALL' | 'BLOCKED'
const robotsReasonMap = new Map(); // origin -> human reason
async function loadRobots(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const set = (v, reason) => { robotsCache.set(origin, v); robotsReasonMap.set(origin, reason); return v; };
  if (!CONFIG.source.respectRobots) return set("ALLOW_ALL", "robots ignored (IGNORE_ROBOTS)");
  const url = origin.replace(/\/$/, "") + "/robots.txt";
  let r = null, lastErr = "";
  for (let attempt = 1; attempt <= 5; attempt++) {
    try { r = await rawGet(url); if (r.status === 429 || r.status >= 500) { lastErr = `HTTP ${r.status}`; r = null; } else break; }
    catch (e) { lastErr = e.message; r = null; }
    if (attempt < 5) await sleep(1200 * attempt);
  }
  if (!r) return set("BLOCKED", `robots.txt unreachable after retries (${lastErr})`);
  if (r.status === 404) return set("ALLOW_ALL", "no robots.txt (404) → allowed");
  if (r.status < 200 || r.status >= 300) return set("BLOCKED", `robots.txt HTTP ${r.status} → cannot confirm permission`);
  const txt = decodeBody(r.buffer, r.contentType);
  const rules = { disallow: [], allow: [] }; let applies = false;
  for (const rawLine of txt.split("\n")) {
    const l = rawLine.split("#")[0].trim(); if (!l) continue;
    const [k, ...rest] = l.split(":"); const key = k.trim().toLowerCase(); const val = rest.join(":").trim();
    if (key === "user-agent") applies = val === "*" || CONFIG.source.userAgent.toLowerCase().includes(val.toLowerCase());
    else if (applies && key === "disallow" && val) rules.disallow.push(val);
    else if (applies && key === "allow" && val) rules.allow.push(val);
  }
  return set(rules, rules.disallow.length ? `disallow: ${rules.disallow.join(", ")}` : "robots.txt permits");
}

const originOf = (u) => { try { return new URL(u).origin; } catch { return new URL(CONFIG.source.baseUrl).origin; } };

export async function robotsAllows(urlStr) {
  const rules = await loadRobots(originOf(urlStr));
  if (rules === "ALLOW_ALL") return true;
  if (rules === "BLOCKED") return false;
  const p = new URL(urlStr).pathname;
  const longest = (arr) => arr.filter((r) => p.startsWith(r)).sort((a, b) => b.length - a.length)[0];
  const dis = longest(rules.disallow), alw = longest(rules.allow);
  if (dis && (!alw || alw.length < dis.length)) return false;
  return true;
}
export async function robotsStatus(urlStr) { const o = originOf(urlStr || CONFIG.source.baseUrl); await loadRobots(o); return robotsReasonMap.get(o) || ""; }

// ---- public: HTML + binary ------------------------------------------------
export async function fetchHtml(urlStr) {
  if (!(await robotsAllows(urlStr))) { const e = new Error("blocked by robots.txt"); e.robots = true; throw e; }
  return withRetry(async () => {
    await throttle();
    const r = await rawGet(urlStr);
    if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
    if (r.status < 200 || r.status >= 400) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return decodeBody(r.buffer, r.contentType);
  }, urlStr);
}

export async function fetchBuffer(urlStr) {
  return withRetry(async () => {
    await throttle();
    const r = await rawGet(urlStr);
    if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
    if (r.status < 200 || r.status >= 400) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return { buffer: r.buffer, contentType: r.contentType };
  }, urlStr);
}

// ---- tiny concurrency limiter ----------------------------------------------
export function limiter(concurrency) {
  let active = 0; const queue = [];
  const next = () => { active--; if (queue.length) queue.shift()(); };
  return (fn) => new Promise((resolve, reject) => {
    const run = () => { active++; Promise.resolve().then(fn).then((v) => { resolve(v); next(); }, (e) => { reject(e); next(); }); };
    if (active < concurrency) run(); else queue.push(run);
  });
}
