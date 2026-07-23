-- ============================================================================
-- 002_identity.sql — admin_users, dealer_tiers, dealers
-- ============================================================================

-- Multiple admins, database-backed. Sole trusted source for is_admin().
-- role/permissions reserved for future granular roles (Phase 1: all active
-- admins have full access).
create table if not exists public.admin_users (
  id          uuid primary key references auth.users on delete cascade,
  email       text unique not null,
  name        text,
  is_active   boolean not null default true,
  role        text not null default 'admin',
  permissions jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Tiers as ROWS (renameable/extendable from Admin), never hard-coded columns.
create table if not exists public.dealer_tiers (
  id                uuid primary key default gen_random_uuid(),
  key               text unique not null,          -- stable machine key
  name              text not null,                 -- editable display label
  sort_order        int  not null default 0,
  is_active         boolean not null default true,
  default_moq       int,                           -- future tier-level MOQ slot
  default_increment int,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Dealer ACCOUNT (current, editable profile). id = auth.uid().
-- Created when an application is first approved (see 010 admin_review_application).
-- status and tier_id are ADMIN-WRITE-ONLY (enforced by trigger in 011 + no
-- direct UPDATE grant to dealers; profile edits go through an RPC).
create table if not exists public.dealers (
  id                     uuid primary key references auth.users on delete cascade,
  status                 dealer_status not null,
  tier_id                uuid references public.dealer_tiers(id),
  business_name          text not null,
  contact_name           text,
  email                  text not null,
  phone                  text,
  address                text,
  city                   text,
  state                  text,
  zip                    text,
  business_type          text,
  website                text,
  social_media           text,
  est_monthly_volume     text,
  approved_application_id uuid,                     -- FK added in 003
  approved_at            timestamptz,
  suspended_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
