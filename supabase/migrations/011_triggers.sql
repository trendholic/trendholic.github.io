-- ============================================================================
-- 011_triggers.sql — updated_at maintenance + dealers status/tier guard
-- ============================================================================

create or replace function public.trg_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'admin_users','dealer_tiers','dealers','products','product_wholesale',
    'product_tier_prices','product_dealer_prices','orders'
  ] loop
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format(
      'create trigger touch_updated_at before update on public.%I
         for each row execute function public.trg_touch_updated_at()', t);
  end loop;
end $$;

-- Backstop: status and tier_id on dealers may change only when the caller is an
-- admin. (Dealers have no direct UPDATE grant anyway; this defends the RPC path.)
create or replace function public.trg_dealers_admin_only_fields()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
begin
  if (new.status is distinct from old.status
      or new.tier_id is distinct from old.tier_id)
     and not public.is_admin() then
    raise exception 'status and tier are admin-controlled';
  end if;
  return new;
end $$;

drop trigger if exists dealers_admin_only_fields on public.dealers;
create trigger dealers_admin_only_fields
  before update on public.dealers
  for each row execute function public.trg_dealers_admin_only_fields();
