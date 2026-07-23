-- ============================================================================
-- 003_applications.sql — dealer_applications + frozen-submission immutability
-- Keeps a permanent, auditable application history separate from dealers.
-- ============================================================================

create table if not exists public.dealer_applications (
  id                   uuid primary key default gen_random_uuid(),
  applicant_user_id    uuid not null references auth.users on delete cascade,
  status               application_status not null default 'pending',

  -- ---- FROZEN submitted snapshot (immutable after insert) ----------------
  business_name        text not null,
  contact_name         text not null,
  email                text not null,
  phone                text not null,
  address              text,
  city                 text,
  state                text,
  zip                  text,
  business_type        text,
  website              text,
  social_media         text,
  est_monthly_volume   text,
  additional_notes     text,
  submitted_at         timestamptz not null default now(),

  -- ---- Mutable admin review fields ---------------------------------------
  reviewed_by          uuid references public.admin_users(id),
  reviewed_at          timestamptz,
  decision             application_status,
  decision_reason      text,
  info_request_message text,
  created_at           timestamptz not null default now()
);

-- At most ONE active (non-terminal) application per user; approved/rejected
-- rows accumulate as history and allow safe reapplication after rejection.
create unique index if not exists uq_active_application_per_user
  on public.dealer_applications (applicant_user_id)
  where status in ('pending', 'under_review', 'info_requested');

-- Late FK: a dealer's approving application.
do $$ begin
  alter table public.dealers
    add constraint fk_dealers_approved_application
    foreign key (approved_application_id)
    references public.dealer_applications(id);
exception when duplicate_object then null; end $$;

-- Immutability of the SUBMITTED fields: an UPDATE may change only review/status
-- columns, never the applicant's original submission.
create or replace function public.trg_freeze_application_submission()
returns trigger language plpgsql as $$
begin
  if new.applicant_user_id is distinct from old.applicant_user_id
     or new.business_name  is distinct from old.business_name
     or new.contact_name   is distinct from old.contact_name
     or new.email          is distinct from old.email
     or new.phone          is distinct from old.phone
     or new.address        is distinct from old.address
     or new.city           is distinct from old.city
     or new.state          is distinct from old.state
     or new.zip            is distinct from old.zip
     or new.business_type  is distinct from old.business_type
     or new.website        is distinct from old.website
     or new.social_media   is distinct from old.social_media
     or new.est_monthly_volume is distinct from old.est_monthly_volume
     or new.additional_notes   is distinct from old.additional_notes
     or new.submitted_at   is distinct from old.submitted_at
  then
    raise exception 'dealer_applications: submitted fields are immutable';
  end if;
  return new;
end $$;

drop trigger if exists freeze_application_submission on public.dealer_applications;
create trigger freeze_application_submission
  before update on public.dealer_applications
  for each row execute function public.trg_freeze_application_submission();
