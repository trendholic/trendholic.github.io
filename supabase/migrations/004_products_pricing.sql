-- ============================================================================
-- 004_products_pricing.sql — products (uuid id + unique sku) and price tables
-- Wholesale price/MOQ live in split tables so RLS protects whole rows.
-- products carries NO wholesale price column (CI-lint enforced later).
-- ============================================================================

-- Catalog master. id = internal UUID (all FKs use it). sku = external key
-- for Google Sheets sync; source is swappable without a rebuild.
create table if not exists public.products (
  id                uuid primary key default gen_random_uuid(),
  sku               text unique not null,           -- e.g. 'A01'
  name              text,
  brand             text,
  gender            text,
  ml                text,
  image_path        text,
  notes             text,
  retail_price_cents int,                            -- reference only (public)
  source            text not null default 'google_sheet',
  external_ref      text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Wholesale eligibility + base fallback + per-product MOQ/increment.
-- FK target for the price tables so a priced product ALWAYS has an eligibility
-- row (closes the "ineligible / MOQ-less order" break).
create table if not exists public.product_wholesale (
  product_id                 uuid primary key
                               references public.products(id) on delete cascade,
  is_wholesale_eligible      boolean not null default false,
  base_wholesale_price_cents int check (base_wholesale_price_cents >= 0),
  allow_base_fallback        boolean not null default true,
  currency                   char(3) not null default 'USD',
  moq                        int not null default 1 check (moq >= 1),
  order_increment            int not null default 1 check (order_increment >= 1),
  updated_at                 timestamptz not null default now()
);

-- Manual per-(product, tier) price. Layer 2 of the hierarchy.
create table if not exists public.product_tier_prices (
  product_id      uuid not null
                    references public.product_wholesale(product_id) on delete cascade,
  tier_id         uuid not null references public.dealer_tiers(id) on delete cascade,
  price_cents     int  not null check (price_cents >= 0),
  moq             int  check (moq is null or moq >= 1),
  order_increment int  check (order_increment is null or order_increment >= 1),
  currency        char(3) not null default 'USD',
  is_active       boolean not null default true,
  updated_at      timestamptz not null default now(),
  primary key (product_id, tier_id)
);

-- Individual dealer override. Layer 1 (top). Ships empty in Phase 1.
create table if not exists public.product_dealer_prices (
  product_id      uuid not null
                    references public.product_wholesale(product_id) on delete cascade,
  dealer_id       uuid not null references public.dealers(id) on delete cascade,
  price_cents     int  not null check (price_cents >= 0),
  moq             int  check (moq is null or moq >= 1),
  order_increment int  check (order_increment is null or order_increment >= 1),
  currency        char(3) not null default 'USD',
  is_active       boolean not null default true,
  effective_from  timestamptz,
  effective_to    timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (product_id, dealer_id)
);
