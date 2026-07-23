-- ============================================================================
-- 012_seed_storage.sql — seed tiers + settings; private dealer-docs bucket
-- ============================================================================

insert into public.dealer_tiers (key, name, sort_order) values
  ('standard',  'Standard',  1),
  ('preferred', 'Preferred', 2),
  ('vip',       'VIP',       3)
on conflict (key) do nothing;

insert into public.settings (key, value) values
  ('default_tier_key', '"standard"'::jsonb),
  ('wholesale_currency', '"USD"'::jsonb)
on conflict (key) do nothing;

-- Private Storage bucket for dealer documents (never public).
insert into storage.buckets (id, name, public)
  values ('dealer-docs', 'dealer-docs', false)
  on conflict (id) do nothing;

-- Storage RLS: a dealer may read/write only objects whose first path segment
-- equals their auth.uid(); admins may read all. (Admin viewing is normally via
-- a short-TTL signed URL minted by the sign-document-url edge function.)
drop policy if exists docs_dealer_rw on storage.objects;
create policy docs_dealer_rw on storage.objects
  for all to authenticated
  using (
    bucket_id = 'dealer-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'dealer-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists docs_admin_read on storage.objects;
create policy docs_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'dealer-docs' and public.is_admin());
