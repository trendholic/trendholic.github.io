-- ============================================================================
-- 013_assertions.sql — migration self-tests. Raise (fail the migration) if a
-- critical security invariant is missing. Run last.
-- ============================================================================

do $$
declare t text; n int;
begin
  -- (a) RLS enabled + forced on every sensitive table
  foreach t in array array[
    'admin_users','dealer_tiers','dealers','dealer_applications',
    'products','product_wholesale','product_tier_prices','product_dealer_prices',
    'orders','order_items','order_status_history',
    'notifications','admin_notes','admin_audit_log','settings'
  ] loop
    if not exists (select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
                   where ns.nspname='public' and c.relname=t
                     and c.relrowsecurity and c.relforcerowsecurity) then
      raise exception 'RLS not enabled+forced on %', t;
    end if;
  end loop;

  -- (b) SECURITY DEFINER functions must pin search_path
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
  where ns.nspname='public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) cfg
                    where cfg like 'search_path=%');
  if n > 0 then
    raise exception '% SECURITY DEFINER functions lack a pinned search_path', n;
  end if;

  -- (c) no wholesale price/moq column may leak onto the public products table
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='products'
      and (column_name ~* 'wholesale' or column_name ~* 'moq'
           or column_name ~* '_cents$' and column_name <> 'retail_price_cents')
  ) then
    raise exception 'products table must not carry wholesale price/MOQ columns';
  end if;

  -- (d) internal resolvers must not be executable by anon/authenticated
  if has_function_privilege('authenticated',
       'public.resolve_price_cents(uuid,uuid,uuid)', 'execute') then
    raise exception 'resolve_price_cents must not be client-executable';
  end if;

  raise notice 'All migration assertions passed.';
end $$;
