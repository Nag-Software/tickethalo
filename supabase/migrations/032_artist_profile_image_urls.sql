alter table artists
  add column if not exists profile_image_urls text[] not null default '{}'::text[];
