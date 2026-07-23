-- ============================================================================
-- 009_rls.sql — Row Level Security. Default-deny everywhere.
--   * Reads = plain declarative RLS (no bypass views).
--   * Writes to price/order tables = RPC-owner only (no dealer grants).
--   * Belt-and-suspenders REVOKEs so a policy slip cannot expose data.
-- ============================================================================

-- Remove the SECURITY DEFINER shadow-object hijack surface.
revoke create on schema public from authenticated, anon, public;

-- Internal resolvers must NOT be client-callable (mitigation: no caller-supplied
-- identity). They run only inside the definer order RPC that owns them.
revoke all on function public.resolve_price_cents(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.resolve_moq(uuid,uuid,uuid)         from public, anon, authenticated;

-- Identity/admin helpers are safe (no args, derive from auth.uid()).
grant execute on function public.auth_dealer_id()     to authenticated;
grant execute on function public.auth_dealer_status() to authenticated;
grant execute on function public.auth_dealer_tier()   to authenticated;
grant execute on function public.is_admin()           to authenticated;

-- Helper: enable + force RLS and strip default table grants in one shot.
do $$
declare t text;
begin
  foreach t in array array[
    'admin_users','dealer_tiers','dealers','dealer_applications',
    'products','product_wholesale','product_tier_prices','product_dealer_prices',
    'orders','order_items','order_status_history',
    'notifications','admin_notes','admin_audit_log','settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    -- belt-and-suspenders: strip ALL default grants (incl. Supabase defaults
    -- to authenticated) so a policy slip cannot expose data via PostgREST.
    execute format('revoke all on public.%I from anon, authenticated, public', t);
  end loop;
end $$;

-- SELECT for every table (RLS row-filters; admins are 'authenticated' too).
grant select on
  public.dealer_tiers, public.dealers, public.dealer_applications,
  public.products, public.product_wholesale, public.product_tier_prices,
  public.product_dealer_prices, public.orders, public.order_items,
  public.order_status_history, public.notifications, public.admin_users,
  public.admin_notes, public.admin_audit_log, public.settings
  to authenticated;

-- Narrow direct writes (all gated by RLS admin/self policies):
--   * dealers/applications/price/order tables are written ONLY via audited
--     SECURITY DEFINER RPCs — NO client write grant here (prevents a dealer
--     from POSTing an order with a forged total, and forces audit logging).
grant update on public.notifications to authenticated;            -- is_read (own row)
grant insert, update, delete on public.dealer_tiers  to authenticated;  -- admin (RLS)
grant insert, update, delete on public.admin_notes   to authenticated;  -- admin (RLS)
grant insert, update, delete on public.settings      to authenticated;  -- admin (RLS)
grant insert, update, delete on public.products      to authenticated;  -- admin (RLS)

-- Dealer documents are files in a PRIVATE Storage bucket governed by storage
-- RLS (012); admins read them via short-lived signed URLs (sign-document-url
-- edge function). No SQL metadata table is exposed to the client.

-- ============================ POLICIES =====================================

-- admin_users: admin only.
drop policy if exists admin_users_admin on public.admin_users;
create policy admin_users_admin on public.admin_users
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- dealer_tiers: a dealer sees only their own tier; admins manage all.
drop policy if exists tiers_own on public.dealer_tiers;
create policy tiers_own on public.dealer_tiers
  for select to authenticated
  using (public.is_admin() or id = public.auth_dealer_tier());
drop policy if exists tiers_admin_write on public.dealer_tiers;
create policy tiers_admin_write on public.dealer_tiers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- dealers: read own row or admin. NO direct dealer UPDATE grant (profile edits
-- go through update_my_dealer_profile RPC; status/tier admin-only + trigger).
drop policy if exists dealers_self on public.dealers;
create policy dealers_self on public.dealers
  for select to authenticated
  using (public.is_admin() or id = auth.uid());
drop policy if exists dealers_admin_write on public.dealers;
create policy dealers_admin_write on public.dealers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- dealer_applications: applicant reads own; admin reads all. Applicants insert
-- via RPC only. Admin updates review fields.
drop policy if exists apps_own_read on public.dealer_applications;
create policy apps_own_read on public.dealer_applications
  for select to authenticated
  using (public.is_admin() or applicant_user_id = auth.uid());
drop policy if exists apps_admin_write on public.dealer_applications;
create policy apps_admin_write on public.dealer_applications
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- products: readable (non-price metadata) by any authenticated user; admin write.
drop policy if exists products_read on public.products;
create policy products_read on public.products
  for select to authenticated using (true);
drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- product_wholesale: approved dealers see only ELIGIBLE rows; admin all.
drop policy if exists pw_read on public.product_wholesale;
create policy pw_read on public.product_wholesale
  for select to authenticated
  using (public.is_admin()
         or (public.auth_dealer_status() = 'approved' and is_wholesale_eligible));
drop policy if exists pw_admin_write on public.product_wholesale;
create policy pw_admin_write on public.product_wholesale
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- product_tier_prices: approved dealer sees ONLY own tier + eligible product.
drop policy if exists ptp_read on public.product_tier_prices;
create policy ptp_read on public.product_tier_prices
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.auth_dealer_status() = 'approved'
      and tier_id = public.auth_dealer_tier()
      and exists (select 1 from public.product_wholesale w
                  where w.product_id = product_tier_prices.product_id
                    and w.is_wholesale_eligible)
    )
  );
drop policy if exists ptp_admin_write on public.product_tier_prices;
create policy ptp_admin_write on public.product_tier_prices
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- product_dealer_prices: approved dealer sees ONLY own active override; admin all.
drop policy if exists pdp_read on public.product_dealer_prices;
create policy pdp_read on public.product_dealer_prices
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.auth_dealer_status() = 'approved'
      and dealer_id = auth.uid()
      and is_active
      and (effective_from is null or effective_from <= now())
      and (effective_to   is null or effective_to   >  now())
    )
  );
drop policy if exists pdp_admin_write on public.product_dealer_prices;
create policy pdp_admin_write on public.product_dealer_prices
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- orders: dealer reads own; admin all. Orders are CREATED only by the definer
-- RPC (place_wholesale_order) — there is deliberately NO client INSERT grant or
-- policy, so a forged total can never be POSTed directly.
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders
  for select to authenticated
  using (public.is_admin() or dealer_id = auth.uid());

-- order_items: readable only through an order the caller owns; admin all.
-- Immutable & RPC-written: no client INSERT/UPDATE/DELETE policy.
drop policy if exists oi_read on public.order_items;
create policy oi_read on public.order_items
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.orders o
               where o.id = order_items.order_id and o.dealer_id = auth.uid())
  );

-- order_status_history: readable via owned order; admin all. Insert by RPC.
drop policy if exists osh_read on public.order_status_history;
create policy osh_read on public.order_status_history
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.orders o
               where o.id = order_status_history.order_id and o.dealer_id = auth.uid())
  );
drop policy if exists osh_admin_write on public.order_status_history;
create policy osh_admin_write on public.order_status_history
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- notifications: recipient reads/updates own (is_read). Insert via RPC/trigger.
drop policy if exists notif_own on public.notifications;
create policy notif_own on public.notifications
  for select to authenticated using (recipient_id = auth.uid());
drop policy if exists notif_own_update on public.notifications;
create policy notif_own_update on public.notifications
  for update to authenticated using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- admin_notes / admin_audit_log / settings: admin only (audit has no
-- update/delete — append-only trigger blocks even admins).
drop policy if exists notes_admin on public.admin_notes;
create policy notes_admin on public.admin_notes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists audit_admin_read on public.admin_audit_log;
create policy audit_admin_read on public.admin_audit_log
  for select to authenticated using (public.is_admin());
drop policy if exists audit_admin_insert on public.admin_audit_log;
create policy audit_admin_insert on public.admin_audit_log
  for insert to authenticated with check (public.is_admin());
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
