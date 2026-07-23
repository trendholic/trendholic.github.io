-- ============================================================================
-- 010_rpcs.sql — SECURITY DEFINER RPCs (pinned search_path).
--   * The ONLY write path for orders (place_wholesale_order).
--   * Admin actions re-check is_admin() and write admin_audit_log in-transaction.
--   * Frontend is authoritative for NOTHING.
-- ============================================================================

-- ---- internal helpers ------------------------------------------------------
create or replace function public._audit(
  p_action text, p_entity_type text, p_entity_id text,
  p_prev jsonb, p_new jsonb, p_meta jsonb default null
) returns void language sql security definer
set search_path = pg_catalog, public as $$
  insert into public.admin_audit_log
    (admin_id, action, entity_type, entity_id, previous_value, new_value, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_prev, p_new, p_meta);
$$;

create or replace function public._notify(
  p_recipient uuid, p_role text, p_type text,
  p_title text, p_body text, p_link text default null
) returns void language sql security definer
set search_path = pg_catalog, public as $$
  insert into public.notifications
    (recipient_id, recipient_role, type, title, body, link_url)
  values (p_recipient, p_role, p_type, p_title, p_body, p_link);
$$;

-- ---- dealer: submit an application -----------------------------------------
create or replace function public.submit_application(payload jsonb)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if exists (select 1 from public.dealer_applications
             where applicant_user_id = auth.uid()
               and status in ('pending','under_review','info_requested')) then
    raise exception 'you already have an application under review';
  end if;

  insert into public.dealer_applications
    (applicant_user_id, status, business_name, contact_name, email, phone,
     address, city, state, zip, business_type, website, social_media,
     est_monthly_volume, additional_notes)
  values
    (auth.uid(), 'pending',
     payload->>'business_name', payload->>'contact_name', payload->>'email',
     payload->>'phone', payload->>'address', payload->>'city', payload->>'state',
     payload->>'zip', payload->>'business_type', payload->>'website',
     payload->>'social_media', payload->>'est_monthly_volume',
     payload->>'additional_notes')
  returning id into v_id;

  -- notify all active admins
  perform public._notify(a.id, 'admin', 'application.submitted',
    'New dealer application', coalesce(payload->>'business_name','(unknown)'),
    '/admin/applications.html')
  from public.admin_users a where a.is_active;

  return v_id;
end $$;

-- ---- dealer: edit own contact fields (never status/tier) -------------------
create or replace function public.update_my_dealer_profile(payload jsonb)
returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
begin
  if public.auth_dealer_id() is null then raise exception 'not a dealer'; end if;
  update public.dealers set
    contact_name = coalesce(payload->>'contact_name', contact_name),
    phone        = coalesce(payload->>'phone', phone),
    address      = coalesce(payload->>'address', address),
    city         = coalesce(payload->>'city', city),
    state        = coalesce(payload->>'state', state),
    zip          = coalesce(payload->>'zip', zip),
    website      = coalesce(payload->>'website', website),
    social_media = coalesce(payload->>'social_media', social_media),
    updated_at   = now()
  where id = auth.uid();
end $$;

-- ---- admin: review an application (approve/reject/request_info/under_review) -
create or replace function public.admin_review_application(
  p_app uuid, p_action text, p_tier_key text default null, p_reason text default null
) returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
declare a public.dealer_applications; v_tier uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into a from public.dealer_applications where id = p_app;
  if not found then raise exception 'application not found'; end if;

  if p_action = 'approve' then
    if p_tier_key is null then raise exception 'tier required to approve'; end if;
    select id into v_tier from public.dealer_tiers where key = p_tier_key and is_active;
    if v_tier is null then raise exception 'unknown tier'; end if;

    -- create or reactivate the dealer account
    insert into public.dealers
      (id, status, tier_id, business_name, contact_name, email, phone, address,
       city, state, zip, business_type, website, social_media, est_monthly_volume,
       approved_application_id, approved_at)
    values
      (a.applicant_user_id, 'approved', v_tier, a.business_name, a.contact_name,
       a.email, a.phone, a.address, a.city, a.state, a.zip, a.business_type,
       a.website, a.social_media, a.est_monthly_volume, a.id, now())
    on conflict (id) do update set
      status = 'approved', tier_id = v_tier,
      approved_application_id = a.id, approved_at = now(), updated_at = now();

    update public.dealer_applications
      set status='approved', decision='approved', reviewed_by=auth.uid(),
          reviewed_at=now() where id = p_app;

    perform public._audit('dealer.approve','application', p_app::text,
      to_jsonb(a.status), '"approved"'::jsonb,
      jsonb_build_object('tier', p_tier_key));
    perform public._notify(a.applicant_user_id,'dealer','application.approved',
      'You are approved', 'Your wholesale account is now active.', '/dealer/dashboard.html');

  elsif p_action = 'reject' then
    update public.dealer_applications
      set status='rejected', decision='rejected', decision_reason=p_reason,
          reviewed_by=auth.uid(), reviewed_at=now() where id = p_app;
    perform public._audit('dealer.reject','application', p_app::text,
      to_jsonb(a.status), '"rejected"'::jsonb, jsonb_build_object('reason', p_reason));
    perform public._notify(a.applicant_user_id,'dealer','application.rejected',
      'Application update', coalesce(p_reason,'Your application was not approved.'), '/dealer/status.html');

  elsif p_action = 'request_info' then
    update public.dealer_applications
      set status='info_requested', info_request_message=p_reason,
          reviewed_by=auth.uid(), reviewed_at=now() where id = p_app;
    perform public._audit('dealer.request_info','application', p_app::text,
      to_jsonb(a.status), '"info_requested"'::jsonb, jsonb_build_object('message', p_reason));
    perform public._notify(a.applicant_user_id,'dealer','application.info_requested',
      'More information needed', coalesce(p_reason,''), '/dealer/status.html');

  elsif p_action = 'under_review' then
    update public.dealer_applications
      set status='under_review', reviewed_by=auth.uid(), reviewed_at=now() where id = p_app;
    perform public._audit('dealer.under_review','application', p_app::text,
      to_jsonb(a.status), '"under_review"'::jsonb, null);
  else
    raise exception 'unknown action %', p_action;
  end if;
end $$;

-- ---- admin: suspend / reactivate / close a dealer --------------------------
create or replace function public.admin_set_dealer_status(
  p_dealer uuid, p_status dealer_status, p_note text default null
) returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_old dealer_status;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select status into v_old from public.dealers where id = p_dealer;
  if not found then raise exception 'dealer not found'; end if;

  update public.dealers set
    status = p_status,
    suspended_at = case when p_status='suspended' then now() else suspended_at end,
    updated_at = now()
  where id = p_dealer;

  perform public._audit(
    case p_status when 'suspended' then 'dealer.suspend'
                  when 'approved'  then 'dealer.reactivate'
                  else 'dealer.close' end,
    'dealer', p_dealer::text, to_jsonb(v_old), to_jsonb(p_status),
    jsonb_build_object('note', p_note));
  perform public._notify(p_dealer,'dealer','dealer.status',
    'Account status updated', p_status::text, '/dealer/dashboard.html');
end $$;

-- ---- admin: set product wholesale eligibility / base price / MOQ -----------
create or replace function public.admin_set_product_wholesale(
  p_product uuid, p_eligible boolean, p_base_cents int,
  p_moq int, p_increment int, p_allow_base boolean default true
) returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_old jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select to_jsonb(w) into v_old from public.product_wholesale w where product_id = p_product;

  insert into public.product_wholesale
    (product_id, is_wholesale_eligible, base_wholesale_price_cents,
     allow_base_fallback, moq, order_increment, updated_at)
  values (p_product, p_eligible, p_base_cents, p_allow_base,
          coalesce(p_moq,1), coalesce(p_increment,1), now())
  on conflict (product_id) do update set
    is_wholesale_eligible = excluded.is_wholesale_eligible,
    base_wholesale_price_cents = excluded.base_wholesale_price_cents,
    allow_base_fallback = excluded.allow_base_fallback,
    moq = excluded.moq, order_increment = excluded.order_increment, updated_at = now();

  perform public._audit('product.wholesale_update','product', p_product::text,
    v_old, (select to_jsonb(w) from public.product_wholesale w where product_id=p_product), null);
end $$;

-- ---- admin: upsert a per-tier price ----------------------------------------
create or replace function public.admin_upsert_tier_price(
  p_product uuid, p_tier uuid, p_price_cents int,
  p_moq int default null, p_increment int default null
) returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_old jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select to_jsonb(t) into v_old from public.product_tier_prices t
    where product_id = p_product and tier_id = p_tier;

  insert into public.product_tier_prices
    (product_id, tier_id, price_cents, moq, order_increment, updated_at)
  values (p_product, p_tier, p_price_cents, p_moq, p_increment, now())
  on conflict (product_id, tier_id) do update set
    price_cents = excluded.price_cents, moq = excluded.moq,
    order_increment = excluded.order_increment, updated_at = now();

  perform public._audit('pricing.tier_update','product', p_product::text,
    v_old, (select to_jsonb(t) from public.product_tier_prices t
            where product_id=p_product and tier_id=p_tier),
    jsonb_build_object('tier_id', p_tier));
end $$;

-- ---- admin: order & payment status -----------------------------------------
create or replace function public.admin_set_order_status(
  p_order uuid, p_status order_status, p_note text default null
) returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_old order_status; v_dealer uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select order_status, dealer_id into v_old, v_dealer from public.orders where id = p_order;
  if not found then raise exception 'order not found'; end if;

  update public.orders set order_status = p_status, updated_at = now(),
    confirmed_at = case when p_status='confirmed' then now() else confirmed_at end,
    shipped_at   = case when p_status='shipped'   then now() else shipped_at end,
    delivered_at = case when p_status='delivered' then now() else delivered_at end,
    cancelled_at = case when p_status='cancelled' then now() else cancelled_at end
  where id = p_order;

  insert into public.order_status_history(order_id,kind,old_value,new_value,changed_by,changed_by_role,note)
    values (p_order,'order',v_old::text,p_status::text,auth.uid(),'admin',p_note);
  perform public._audit('order.status','order', p_order::text,
    to_jsonb(v_old), to_jsonb(p_status), null);
  perform public._notify(v_dealer,'dealer','order.status',
    'Order '||p_status::text, 'Your order status changed.', '/dealer/order.html?id='||p_order);
end $$;

create or replace function public.admin_set_payment_status(
  p_order uuid, p_status payment_status, p_note text default null
) returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_old payment_status; v_dealer uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select payment_status, dealer_id into v_old, v_dealer from public.orders where id = p_order;
  if not found then raise exception 'order not found'; end if;

  update public.orders set payment_status = p_status, updated_at = now() where id = p_order;
  insert into public.order_status_history(order_id,kind,old_value,new_value,changed_by,changed_by_role,note)
    values (p_order,'payment',v_old::text,p_status::text,auth.uid(),'admin',p_note);
  perform public._audit('payment.status','order', p_order::text,
    to_jsonb(v_old), to_jsonb(p_status), null);
  perform public._notify(v_dealer,'dealer','payment.status',
    'Payment '||p_status::text, 'Your payment status changed.', '/dealer/order.html?id='||p_order);
end $$;

-- ---- dealer: place a wholesale order (THE authoritative write path) ---------
create or replace function public.place_wholesale_order(
  p_lines jsonb, p_ship_to jsonb default null,
  p_note text default null, p_idempotency_key text default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  v_dealer public.dealers;
  v_tier_key text; v_tier_name text;
  v_currency char(3);
  v_order_id uuid;
  v_number text;
  v_subtotal bigint := 0;
  v_count int := 0; v_qty_total int := 0;
  rec record; v_price int; v_src text; v_moq int; v_inc int; v_line bigint;
  v_wholesale public.product_wholesale;
  v_existing uuid;
begin
  -- 1. auth + status gate (covers reqs 1-4 at write time)
  select * into v_dealer from public.dealers where id = auth.uid();
  if not found or v_dealer.status <> 'approved' then
    raise exception 'not an approved dealer';
  end if;

  -- 2. idempotency
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'idempotency key required';
  end if;
  select id into v_existing from public.orders
    where dealer_id = v_dealer.id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return jsonb_build_object('order_id', v_existing, 'duplicate', true);
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'empty order';
  end if;

  -- 3. strict integer quantity validation (blocks fractional/zero/negative)
  if exists (select 1 from jsonb_array_elements(p_lines) e
             where (e->>'quantity') !~ '^[1-9][0-9]*$'
                or (e->>'quantity')::bigint > 100000) then
    raise exception 'invalid quantity (must be a positive integer)';
  end if;

  select t.key, t.name into v_tier_key, v_tier_name
    from public.dealer_tiers t where t.id = v_dealer.tier_id;

  v_number := 'WH-' || to_char(now(),'YYYYMMDD') || '-' ||
              upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  -- create order shell (totals filled after lines)
  insert into public.orders
    (id, order_number, dealer_id, currency, subtotal_cents, total_cents,
     tier_id_snapshot, tier_key_snapshot, tier_name_snapshot, ship_to,
     dealer_note, idempotency_key)
  values
    (gen_random_uuid(), v_number, v_dealer.id, 'USD', 0, 0,
     v_dealer.tier_id, v_tier_key, v_tier_name, p_ship_to, p_note, p_idempotency_key)
  returning id, currency into v_order_id, v_currency;

  -- 4. per (aggregated) product line, resolve authoritatively and snapshot
  for rec in
    select (e->>'product_id')::uuid as pid, sum((e->>'quantity')::int) as qty
    from jsonb_array_elements(p_lines) e
    group by (e->>'product_id')::uuid
  loop
    select * into v_wholesale from public.product_wholesale where product_id = rec.pid;
    if not found or not v_wholesale.is_wholesale_eligible then
      raise exception 'product % is not available for wholesale', rec.pid;
    end if;
    if v_wholesale.currency <> v_currency then
      raise exception 'currency mismatch on product %', rec.pid;
    end if;

    select price_cents, source into v_price, v_src
      from public.resolve_price_cents(rec.pid, v_dealer.id, v_dealer.tier_id);
    if v_price is null then
      raise exception 'product % is not available for wholesale', rec.pid;
    end if;

    select moq, increment into v_moq, v_inc
      from public.resolve_moq(rec.pid, v_dealer.id, v_dealer.tier_id);
    if rec.qty < v_moq then
      raise exception 'below MOQ for %: need >= %', rec.pid, v_moq;
    end if;
    if ((rec.qty - v_moq) % v_inc) <> 0 then
      raise exception 'quantity for % must be % + multiples of %', rec.pid, v_moq, v_inc;
    end if;

    v_line := v_price::bigint * rec.qty;
    v_subtotal := v_subtotal + v_line;
    v_count := v_count + 1;
    v_qty_total := v_qty_total + rec.qty;

    insert into public.order_items
      (order_id, product_id, sku_snapshot, product_name_snapshot, brand_snapshot,
       ml_snapshot, unit_price_cents_snapshot, quantity, line_subtotal_cents_snapshot,
       tier_id_snapshot, price_source_snapshot, currency)
    select v_order_id, rec.pid, p.sku, p.name, p.brand, p.ml,
           v_price, rec.qty, v_line, v_dealer.tier_id, v_src, v_currency
    from public.products p where p.id = rec.pid;
  end loop;

  -- 5. finalize server-computed totals
  update public.orders
    set subtotal_cents = v_subtotal, total_cents = v_subtotal, updated_at = now()
    where id = v_order_id;

  insert into public.order_status_history(order_id,kind,old_value,new_value,changed_by,changed_by_role)
    values (v_order_id,'order',null,'submitted',auth.uid(),'dealer');

  -- notify admins
  perform public._notify(a.id,'admin','order.submitted',
    'New wholesale order '||v_number, v_dealer.business_name, '/admin/order.html?id='||v_order_id)
  from public.admin_users a where a.is_active;

  return jsonb_build_object(
    'order_id', v_order_id, 'order_number', v_number,
    'item_count', v_count, 'total_qty', v_qty_total,
    'subtotal_cents', v_subtotal, 'total_cents', v_subtotal, 'currency', v_currency);
end $$;

-- ---- grants: clients may EXECUTE the public RPCs (each self-checks) ---------
grant execute on function
  public.submit_application(jsonb),
  public.update_my_dealer_profile(jsonb),
  public.admin_review_application(uuid,text,text,text),
  public.admin_set_dealer_status(uuid,dealer_status,text),
  public.admin_set_product_wholesale(uuid,boolean,int,int,int,boolean),
  public.admin_upsert_tier_price(uuid,uuid,int,int,int),
  public.admin_set_order_status(uuid,order_status,text),
  public.admin_set_payment_status(uuid,payment_status,text),
  public.place_wholesale_order(jsonb,jsonb,text,text)
  to authenticated;

-- internal helpers are NOT granted to clients
revoke all on function public._audit(text,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public._notify(uuid,text,text,text,text,text)   from public, anon, authenticated;
