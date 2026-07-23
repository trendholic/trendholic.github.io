// wcart.js — the DEALER wholesale cart. Client convenience only: it holds
// { product_id: quantity }. Prices and totals are NEVER trusted from here —
// place_wholesale_order recomputes everything server-side.
const KEY = "th_wholesale_cart";

export function getCart(){
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
export function setCart(obj){ localStorage.setItem(KEY, JSON.stringify(obj)); }
export function setQty(pid, qty){
  const c = getCart();
  if(qty > 0) c[pid] = qty; else delete c[pid];
  setCart(c);
}
export function removeItem(pid){ const c=getCart(); delete c[pid]; setCart(c); }
export function clearCart(){ localStorage.removeItem(KEY); }
export function distinctCount(){ return Object.keys(getCart()).length; }
export function lines(){ return Object.entries(getCart()).map(([product_id,quantity])=>({product_id, quantity})); }
