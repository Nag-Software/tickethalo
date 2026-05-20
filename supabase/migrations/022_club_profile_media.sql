-- ============================================================
-- Migration 022: Club profile media and content fields
-- ============================================================

insert into storage.buckets (id, name, public)
values ('club-media', 'club-media', true)
on conflict (id) do nothing;

create policy "Public read club-media"
  on storage.objects for select
  using (bucket_id = 'club-media');

create policy "Admin manages club-media"
  on storage.objects for all
  using (bucket_id = 'club-media' and is_admin());

alter table clubs
  add column if not exists header_image_url text,
  add column if not exists gallery_image_urls text[] not null default '{}'::text[],
  add column if not exists location_name text,
  add column if not exists address_line text;