-- ============================================================================
-- 005_orders.sql — orders, order_items (immutable snapshots), status history
-- order_status and payment_status are SEPARATE columns.
-- ============================================================================

create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     text unique not null,
  dealer_id        uuid not null references public.dealers(id),

  order_status     order_status   not null default 'submitted',
  payment_status   payment_status not null default 'pending',

  currency         char(3) not null default 'USD',
  subtotal_cents   bigint  not null,
  discount_cents   bigint  not null default 0,
  total_cents      bigint  not null,

  -- dealer tier snapshot at time of purchase
  tier_id_snapshot   uuid,
  tier_key_snapshot  text,
  tier_name_snapshot text,

  ship_to          jsonb,
  dealer_note      text,
  admin_note       text,
  carrier          text,
  tracking_number  text,
  idempotency_key  text,

  placed_at        timestamptz not null default now(),
  confirmed_at     timestamptz,
  shipped_at       timestamptz,
  delivered_at     timestamptz,
  cancelled_at     timestamptz,
  updated_at       timestamptz not null default now(),

  unique (dealer_id, idempotency_key)
);

-- Immutable per-line snapshot. Written ONLY by place_wholesale_order RPC.
create table if not exists public.order_items (
  id                          uuid primary key default gen_random_uuid(),
  order_id                    uuid not null references public.orders(id) on delete cascade,
  product_id                  uuid,                    -- internal UUID snapshot
  sku_snapshot                text,
  product_name_snapshot       text,
  brand_snapshot              text,
  ml_snapshot                 text,
  unit_price_cents_snapshot   int    not null,
  quantity                    int    not null check (quantity > 0),
  line_subtotal_cents_snapshot bigint not null,
  line_discount_cents         bigint not null default 0,
  tier_id_snapshot            uuid,
  price_source_snapshot       text,                    -- 'dealer_override'|'tier'|'base'
  currency                    char(3) not null default 'USD',
  created_at                  timestamptz not null default now()
);

create table if not exists public.order_status_history (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  kind            text not null check (kind in ('order', 'payment')),
  old_value       text,
  new_value       text not null,
  changed_by      uuid,
  changed_by_role text,
  note            text,
  created_at      timestamptz not null default now()
);

-- Immutability: order_items may never be updated or deleted (except via the
-- parent order's ON DELETE CASCADE). Guarantees historical accuracy forever.
create or replace function public.trg_block_order_item_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'order_items are immutable historical snapshots';
end $$;

drop trigger if exists block_order_item_update on public.order_items;
create trigger block_order_item_update
  before update on public.order_items
  for each row execute function public.trg_block_order_item_mutation();
