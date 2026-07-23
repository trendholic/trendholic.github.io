-- ============================================================================
-- 008_helpers.sql — SECURITY DEFINER helpers (pinned search_path)
-- These derive identity/role from auth.uid() only. The price/MOQ resolvers
-- take identity args but are NOT execute-granted to clients (see 009); they are
-- called only inside the definer order RPC, which owns them.
-- ============================================================================

-- Identity of the calling approved dealer (NULL for retail/pending/etc.).
create or replace function public.auth_dealer_id()
returns uuid language sql stable security definer
set search_path = pg_catalog, public as $$
  select id from public.dealers where id = auth.uid();
$$;

create or replace function public.auth_dealer_status()
returns dealer_status language sql stable security definer
set search_path = pg_catalog, public as $$
  select status from public.dealers where id = auth.uid();
$$;

create or replace function public.auth_dealer_tier()
returns uuid language sql stable security definer
set search_path = pg_catalog, public as $$
  select tier_id from public.dealers where id = auth.uid();
$$;

-- Admin check — reads ONLY the server-managed admin_users table.
create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.admin_users
    where id = auth.uid() and is_active
  );
$$;

-- ---- Internal resolvers (NOT client-callable; used inside the order RPC) ----

-- Authoritative unit price (cents) for a (dealer, tier, product), applying the
-- hierarchy: dealer override -> tier price -> eligible base -> NULL.
-- Returns (price_cents, source). NULL price => not available for wholesale.
create or replace function public.resolve_price_cents(
  p_product uuid, p_dealer uuid, p_tier uuid
) returns table (price_cents int, source text)
language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare v_price int; v_src text;
begin
  -- Layer 1: individual dealer override (within effective window)
  select price_cents into v_price
  from public.product_dealer_prices
  where product_id = p_product and dealer_id = p_dealer and is_active
    and (effective_from is null or effective_from <= now())
    and (effective_to   is null or effective_to   >  now());
  if v_price is not null then price_cents := v_price; source := 'dealer_override'; return next; return; end if;

  -- Layer 2: tier price
  select price_cents into v_price
  from public.product_tier_prices
  where product_id = p_product and tier_id = p_tier and is_active;
  if v_price is not null then price_cents := v_price; source := 'tier'; return next; return; end if;

  -- Layer 3: product base fallback (only if eligible and allowed)
  select base_wholesale_price_cents into v_price
  from public.product_wholesale
  where product_id = p_product and is_wholesale_eligible and allow_base_fallback;
  if v_price is not null then price_cents := v_price; source := 'base'; return next; return; end if;

  -- Not available
  return;
end $$;

-- Authoritative (moq, increment) for a (dealer, tier, product):
-- dealer override -> tier row -> product default -> tier default -> (1,1).
create or replace function public.resolve_moq(
  p_product uuid, p_dealer uuid, p_tier uuid
) returns table (moq int, increment int)
language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare d_moq int; d_inc int; t_moq int; t_inc int;
        p_moq int; p_inc int; td_moq int; td_inc int;
begin
  select moq, order_increment into d_moq, d_inc
  from public.product_dealer_prices
  where product_id = p_product and dealer_id = p_dealer and is_active;

  select moq, order_increment into t_moq, t_inc
  from public.product_tier_prices
  where product_id = p_product and tier_id = p_tier and is_active;

  select moq, order_increment into p_moq, p_inc
  from public.product_wholesale where product_id = p_product;

  select default_moq, default_increment into td_moq, td_inc
  from public.dealer_tiers where id = p_tier;

  moq       := coalesce(d_moq, t_moq, p_moq, td_moq, 1);
  increment := coalesce(d_inc, t_inc, p_inc, td_inc, 1);
  if moq < 1 then moq := 1; end if;
  if increment < 1 then increment := 1; end if;
  return next;
end $$;
