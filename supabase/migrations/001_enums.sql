-- ============================================================================
-- 001_enums.sql — Extensions + enum types
-- TrendHolic Wholesale System · Phase 1
-- Order status and payment status are DELIBERATELY separate enums.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- Dealer ACCOUNT status. A dealers row exists only once an application is
-- approved; the 'pending' state lives in dealer_applications, not here.
do $$ begin
  create type dealer_status as enum ('approved', 'suspended', 'closed');
exception when duplicate_object then null; end $$;

-- Application lifecycle (audit history in dealer_applications).
do $$ begin
  create type application_status as enum
    ('pending', 'under_review', 'info_requested', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- Fulfillment / order status — SEPARATE from payment.
do $$ begin
  create type order_status as enum
    ('submitted', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled');
exception when duplicate_object then null; end $$;

-- Payment status — SEPARATE from order status.
do $$ begin
  create type payment_status as enum
    ('pending', 'invoice_sent', 'pending_payment', 'paid',
     'partially_paid', 'refunded', 'cancelled');
exception when duplicate_object then null; end $$;
