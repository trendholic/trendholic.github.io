// layout.js — shared portal shell (sidebar + topbar) for Dealer & Admin pages.
// Keeps auth/nav/theme in ONE place so pages never duplicate it.
import { supabase } from "./supabase.js";
import { requireAdmin, requireApprovedDealer, requireAuth, signOut } from "./guard.js";
import { hasConfig, devBanner, escapeHtml, chip } from "./ui.js";

const NAV = {
  dealer: [
    ["dashboard","Dashboard","◧","/dealer/dashboard.html"],
    ["catalog","Catalog","▤","/dealer/catalog.html"],
    ["cart","Cart","▦","/dealer/cart.html"],
    ["orders","Orders","▣","/dealer/orders.html"],
    ["account","Account","◔","/dealer/account.html"],
  ],
  admin: [
    ["dashboard","Overview","◧","/admin/dashboard.html"],
    ["applications","Applications","◫","/admin/applications.html"],
    ["dealers","Dealers","◍","/admin/dealers.html"],
    ["products","Products","▤","/admin/products.html"],
    ["pricing","Pricing","$","/admin/pricing.html"],
    ["orders","Orders","▣","/admin/orders.html"],
    ["notifications","Notifications","◈","/admin/notifications.html"],
    ["settings","Settings","⚙","/admin/settings.html"],
  ],
};

function initTheme(){
  const saved = localStorage.getItem("th_theme");
  if(saved) document.documentElement.setAttribute("data-theme", saved);
}
function toggleTheme(){
  const cur = document.documentElement.getAttribute("data-theme")
    || (matchMedia("(prefers-color-scheme:dark)").matches ? "dark":"light");
  const next = cur === "dark" ? "light":"dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("th_theme", next);
}

function buildShell(portal, active, title, userLabel){
  const links = NAV[portal].map(([key,label,ic,href])=>
    `<a class="navlink ${key===active?"active":""}" href="${href}"><span class="ic">${ic}</span>${label}</a>`
  ).join("");
  document.body.innerHTML = `
    <div class="sidebar-back" id="sbBack"></div>
    <div class="app">
      <aside class="sidebar" id="sb">
        <div class="brand"><b>TREND</b>HOLIC</div>
        <div class="brand-tag">${portal==="admin"?"Admin Console":"Dealer Portal"}</div>
        ${links}
        <div class="sidebar-foot">
          <div class="side-user">${userLabel||""}</div>
          <button class="btn btn-sm btn-ghost" id="themeBtn">◐ Theme</button>
          <button class="btn btn-sm" id="logoutBtn">Sign out</button>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <div style="display:flex;align-items:center;gap:12px">
            <button class="hamburger" id="ham">☰</button>
            <h1>${escapeHtml(title)}</h1>
          </div>
          <div class="topbar-actions"></div>
        </div>
        <div class="content" id="content"></div>
      </div>
    </div>
    <div id="toasts"></div>`;
  document.getElementById("themeBtn").onclick = toggleTheme;
  document.getElementById("logoutBtn").onclick = () =>
    signOut(portal==="admin" ? "/admin/login.html" : "/index.html");
  const sb = document.getElementById("sb"), back = document.getElementById("sbBack");
  document.getElementById("ham").onclick = ()=>{ sb.classList.toggle("open"); back.classList.toggle("open"); };
  back.onclick = ()=>{ sb.classList.remove("open"); back.classList.remove("open"); };
  return document.getElementById("content");
}

// initPage({ portal, active, title, guard:'admin'|'dealer'|'auth' })
// Returns { connected, main, user, ctx }. If a guard redirected, returns null.
export async function initPage(opts){
  initTheme();
  const title = opts.title || document.title;

  if(!hasConfig()){
    const main = buildShell(opts.portal, opts.active, title, "Not connected");
    main.innerHTML = devBanner();
    return { connected:false, main, user:null, ctx:null };
  }

  let ctx = null, userLabel = "";
  if(opts.guard === "admin"){
    ctx = await requireAdmin(); if(!ctx) return null;
    userLabel = `<b>${escapeHtml(ctx.admin.name||ctx.admin.email)}</b>Admin`;
  } else if(opts.guard === "dealer"){
    ctx = await requireApprovedDealer(); if(!ctx) return null;
    userLabel = `<b>${escapeHtml(ctx.dealer.business_name)}</b>${chip(ctx.dealer.status)}`;
  } else {
    const user = await requireAuth(opts.portal==="admin"?"/admin/login.html":"/dealer/login.html");
    if(!user) return null; ctx = { user };
  }
  const main = buildShell(opts.portal, opts.active, title, userLabel);
  return { connected:true, main, user:ctx.user, ctx };
}

export { supabase };
