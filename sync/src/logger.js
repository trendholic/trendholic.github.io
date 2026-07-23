// logger.js — console + persistent failure log. Failures never stop the run.
import fs from "node:fs";
import path from "node:path";
import CONFIG from "../config.js";

const failures = [];
const counters = {
  ok: 0, failed: 0, skipped: 0, unchanged: 0,
  translated: 0, translateFailed: 0,
  images: 0, downloadFailed: 0,
  categories: 0, productUrls: 0,
};

const ts = () => new Date().toISOString();
const line = (level, msg) => console.log(`${ts()} [${level}] ${msg}`);

export const log = {
  info: (m) => line("INFO", m),
  warn: (m) => line("WARN", m),
  error: (m) => line("ERROR", m),
  ok: (m) => { counters.ok++; line("OK", m); },
  step: (m) => line("STEP", `── ${m}`),
  count: counters,
  // record a failure with context, then CONTINUE
  fail(context, err, extra = {}) {
    counters.failed++;
    const entry = { time: ts(), context, error: err?.message || String(err), ...extra };
    failures.push(entry);
    line("FAIL", `${context}: ${entry.error}`);
  },
  skip(m) { counters.skipped++; line("SKIP", m); },
  // flush the failure log + a run summary to disk
  flush(summary = {}) {
    try {
      fs.mkdirSync(CONFIG.out.logDir, { recursive: true });
      const stamp = ts().replace(/[:.]/g, "-");
      const file = path.join(CONFIG.out.logDir, `sync-${stamp}.json`);
      fs.writeFileSync(file, JSON.stringify({ summary: { ...counters, ...summary }, failures }, null, 2));
      line("INFO", `Log written: ${path.relative(CONFIG.out.repoRoot, file)}`);
    } catch (e) { line("ERROR", `Could not write log: ${e.message}`); }
    return { counters: { ...counters }, failures: [...failures] };
  },
};

export default log;
