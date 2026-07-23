// ui.js — shared UI helpers for the Dealer + Admin portals.
// No secrets, no data. Pure presentation + small utilities.

export function hasConfig(){
  const c = window.TRENDHOLIC_CONFIG || {};
  return !!c.SUPABASE_URL && !!c.SUPABASE_ANON_KEY
      && !/YOUR-|REPLACE/i.test(c.SUPABASE_URL + c.SUPABASE_ANON_KEY);
}

export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

// integer cents -> "$1,234.50"
export function money(cents, currency = "USD"){
  if (cents == null || cents === "") return "—";
  const n = Number(cents) / 100;
  try { return new Intl.NumberFormat("en-US",{ style:"currency", currency }).format(n); }
  catch { return "$" + n.toFixed(2); }
}
export const dollarsToCents = (s) => {
  const n = Number(String(s).replace(/[^0-9.]/g,""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
export function fmtDate(d){
  if(!d) return "—";
  try { return new Date(d).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"}); }
  catch { return String(d); }
}

// Status -> chip class + label. Semantic colors, separate from the gold accent.
const CHIP = {
  // dealer / application
  approved:["good","Approved"], pending:["warn","Pending"], under_review:["info","Under review"],
  info_requested:["warn","Info requested"], rejected:["crit","Rejected"], suspended:["crit","Suspended"],
  closed:["mute","Closed"],
  // order status
  submitted:["info","Submitted"], confirmed:["info","Confirmed"], processing:["gold","Processing"],
  shipped:["info","Shipped"], delivered:["good","Delivered"], cancelled:["crit","Cancelled"],
  // payment status
  invoice_sent:["info","Invoice sent"], pending_payment:["warn","Payment pending"],
  paid:["good","Paid"], partially_paid:["warn","Partially paid"], refunded:["mute","Refunded"],
};
export function chip(status){
  const [cls,label] = CHIP[status] || ["mute", status ?? "—"];
  return `<span class="chip ${cls}">${escapeHtml(label)}</span>`;
}

export function toast(msg, kind){
  let host = document.getElementById("toasts");
  if(!host){ host = document.createElement("div"); host.id="toasts"; document.body.appendChild(host); }
  const t = document.createElement("div");
  t.className = "toast " + (kind||"");
  t.textContent = msg;
  host.appendChild(t);
  requestAnimationFrame(()=>t.classList.add("show"));
  setTimeout(()=>{ t.classList.remove("show"); setTimeout(()=>t.remove(),300); }, 2600);
}

// Minimal modal. content = HTML string. Returns {close}.
export function modal(title, bodyHtml){
  const back = document.createElement("div");
  back.className = "modal-back open";
  back.innerHTML = `<div class="modal"><div class="modal-head"><h3>${escapeHtml(title)}</h3>
    <button class="modal-x" aria-label="Close">&times;</button></div>
    <div class="modal-body"></div></div>`;
  back.querySelector(".modal-body").innerHTML = bodyHtml;
  const close = ()=>back.remove();
  back.querySelector(".modal-x").onclick = close;
  back.addEventListener("click",(e)=>{ if(e.target===back) close(); });
  document.body.appendChild(back);
  return { el: back, close, body: back.querySelector(".modal-body") };
}

export function debounce(fn, ms=250){
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); };
}

// state renderers
export const loadingState = (msg="Loading…") =>
  `<div class="state"><div class="spinner"></div><div>${escapeHtml(msg)}</div></div>`;
export const emptyState = (title="Nothing here yet", sub="") =>
  `<div class="state"><div class="ic">◍</div><h3>${escapeHtml(title)}</h3>
   ${sub?`<div>${escapeHtml(sub)}</div>`:""}</div>`;
export const errorState = (msg) =>
  `<div class="state"><div class="ic">⚠</div><h3>Something went wrong</h3>
   <div>${escapeHtml(msg||"")}</div></div>`;
export const devBanner = () =>
  `<div class="devbanner"><span>⚙️</span><div><b>Backend not connected (development state).</b>
   This page is wired to the approved Supabase schema and RPCs but no live project is
   configured yet. Add <code>assets/config.js</code> (from <code>config.example.js</code>)
   with your Project URL + anon key to activate it. No mock data is shown.</div></div>`;

// simple client-side pagination helper
export function paginate(items, page, per){
  const total = Math.ceil(items.length / per) || 1;
  const p = Math.min(Math.max(1,page), total);
  return { slice: items.slice((p-1)*per, p*per), page:p, total };
}
export function pagerHtml(page, total){
  if(total<=1) return "";
  let h = `<div class="pager"><button data-pg="${page-1}" ${page===1?"disabled":""}>Prev</button>`;
  for(let i=1;i<=total;i++) h+=`<button data-pg="${i}" class="${i===page?"active":""}">${i}</button>`;
  h += `<button data-pg="${page+1}" ${page===total?"disabled":""}>Next</button></div>`;
  return h;
}
