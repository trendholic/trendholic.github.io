// robots.js — generate /robots.txt pointing crawlers at the sitemap.
// Additive: written to the repo root. If a robots.txt already exists it is
// only overwritten when it carries our managed marker (never clobbers a
// hand-authored file).
import fs from "node:fs";
import CONFIG from "../config.js";
import log from "./logger.js";

const MARKER = "# managed-by: trendholic-product-sync";

export function writeRobots() {
  if (CONFIG.dryRun) return;
  const base = CONFIG.out.siteBaseUrl.replace(/\/$/, "");
  const target = CONFIG.out.repoRoot + "/robots.txt";
  try {
    if (fs.existsSync(target)) {
      const cur = fs.readFileSync(target, "utf8");
      if (!cur.includes(MARKER)) { log.warn("robots.txt exists and is not managed by sync — left untouched."); return; }
    }
    fs.writeFileSync(target,
      `${MARKER}\nUser-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
  } catch (e) { log.warn(`robots.txt not written: ${e.message}`); }
}
