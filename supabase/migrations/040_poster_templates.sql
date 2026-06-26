-- ============================================================
-- Migration 040: Poster templates ("plakatmal")
--
-- A poster template is a reusable, deterministic layout derived once from a
-- previous poster a booker likes. Every future show renders into it by code:
-- text and logos are composited from real fonts + the real logo PNG, never
-- re-painted by an image model. This is the structure that makes results
-- consistent and keeps logos/Norwegian text pixel-exact.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('poster-templates', 'poster-templates', true)
on conflict (id) do nothing;

create table if not exists poster_templates (
  id                 uuid primary key default gen_random_uuid(),
  club_id            uuid not null references clubs(id) on delete cascade,

  name               text not null default 'Plakatmal',
  status             text not null default 'draft'
                       check (status in ('draft', 'confirmed')),

  -- Original upload + the derived clean background plate (faces/old text removed).
  source_poster_path text,
  source_poster_url  text,
  plate_path         text,
  plate_url          text,

  canvas_width       int  not null default 1024,
  canvas_height      int  not null default 1536,

  -- Layout, all normalized (0..1) coordinates. See lib/poster-template.ts.
  palette            jsonb not null default '[]'::jsonb,
  text_slots         jsonb not null default '[]'::jsonb,
  photo_frames       jsonb not null default '[]'::jsonb,
  logos              jsonb not null default '[]'::jsonb,

  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  confirmed_at       timestamptz
);

alter table poster_templates enable row level security;

create index if not exists idx_poster_templates_club on poster_templates(club_id, status);

-- Selection: per-show override + per-club default.
alter table shows
  add column if not exists selected_poster_template_id uuid;

alter table clubs
  add column if not exists default_poster_template_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shows_selected_poster_template_id_fkey'
  ) then
    alter table shows
      add constraint shows_selected_poster_template_id_fkey
      foreign key (selected_poster_template_id)
      references poster_templates(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'clubs_default_poster_template_id_fkey'
  ) then
    alter table clubs
      add constraint clubs_default_poster_template_id_fkey
      foreign key (default_poster_template_id)
      references poster_templates(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_shows_selected_poster_template_id on shows(selected_poster_template_id);
create index if not exists idx_clubs_default_poster_template_id on clubs(default_poster_template_id);

-- Allow the new 'template' poster mode alongside the existing two.
alter table shows drop constraint if exists shows_poster_mode_check;
alter table shows
  add constraint shows_poster_mode_check
  check (poster_mode in ('framed', 'ai_generated', 'template'));

-- RLS: mirror show_marketing_designs. Service-role (admin client) bypasses RLS;
-- the real tenant boundary stays app-level (assertShowAccess / assertClubAccess).
create policy "Admins manage poster templates"
  on poster_templates for all
  using (is_admin());

create policy "Public read poster-templates"
  on storage.objects for select
  using (bucket_id = 'poster-templates');

create policy "Admin manages poster-templates"
  on storage.objects for all
  using (bucket_id = 'poster-templates' and is_admin());
