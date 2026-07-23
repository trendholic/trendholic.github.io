-- ============================================================================
-- 006_support.sql — notifications, admin_notes, admin_audit_log, settings
-- ============================================================================

create table if not exists public.notifications (
  id             uuid primary key default gen_random_uuid(),
  recipient_id   uuid not null,
  recipient_role text not null check (recipient_role in ('dealer', 'admin')),
  type           text,
  title          text not null,
  body           text,
  link_url       text,
  is_read        boolean not null default false,
  created_at     timestamptz not null default now()
);

create table if not exists public.admin_notes (
  id         uuid primary key default gen_random_uuid(),
  dealer_id  uuid references public.dealers(id) on delete cascade,
  order_id   uuid references public.orders(id) on delete cascade,
  admin_id   uuid references public.admin_users(id),
  note       text not null,
  created_at timestamptz not null default now()
);

-- Append-only audit trail. Written inside admin RPCs (server-side) so it can
-- neither be skipped nor forged. Protected from modification by trigger below.
create table if not exists public.admin_audit_log (
  id             uuid primary key default gen_random_uuid(),
  admin_id       uuid references public.admin_users(id),
  action         text not null,        -- e.g. 'dealer.approve','pricing.update'
  entity_type    text not null,        -- 'dealer'|'application'|'product'|'order'|'tier'
  entity_id      text,
  previous_value jsonb,
  new_value      jsonb,
  metadata       jsonb,
  created_at     timestamptz not null default now()
);

create or replace function public.trg_block_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'admin_audit_log is append-only';
end $$;

drop trigger if exists block_audit_update on public.admin_audit_log;
create trigger block_audit_update
  before update or delete on public.admin_audit_log
  for each row execute function public.trg_block_audit_mutation();

create table if not exists public.settings (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
