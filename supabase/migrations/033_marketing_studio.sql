-- ============================================================
-- Migration 033: Markedsføringsstudioet på showet
--
-- Marketing-fanen var én AI-knapp. Den er nå et verktøy klubben
-- styrer selv, og AI-plakaten er bare én av kildene:
--
--   * `shows.auto_poster_enabled` — AI-plakaten genereres IKKE
--     lenger automatisk ved publisering. Standard er av; klubben
--     skrur den på per show hvis den vil ha den.
--   * `shows.poster_source` — sier om plakaten som ligger på
--     showet er lastet opp av klubben eller generert av AI.
--   * `shows.marketing_palette` — merkevarefargene plakaten og
--     eksportene bruker. NULL = arv fra `clubs.brand_color`.
--
-- `show_marketing_designs` var låst til ett show. Den er nå et
-- bibliotek: `club_id` uten `show_id` er en mal klubben kan bruke
-- på alle show, og `slot_count` gjør at en lineup med sju komikere
-- kan finne malene som faktisk har sju bilderuter.
--
-- `show_marketing_slots` er koblingen mellom rutene i malen og
-- bookingene, og `show_marketing_exports` er de ferdige filene
-- (Facebook-cover, A3, A4, SoMe).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- shows — plakatkilde, automatikk og farger
-- ─────────────────────────────────────────────────────────────
alter table shows
  add column if not exists auto_poster_enabled boolean not null default false,
  add column if not exists poster_source       text,
  add column if not exists marketing_palette   jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shows_poster_source_check') then
    alter table shows
      add constraint shows_poster_source_check
      check (poster_source is null or poster_source in ('ai', 'upload'));
  end if;
end $$;

comment on column shows.auto_poster_enabled is
  'Av som standard. På = AI-plakaten genereres når lineupen publiseres.';
comment on column shows.poster_source is
  'Hvor shows.poster_url kom fra: ''upload'' (klubbens egen fil) eller ''ai''.';
comment on column shows.marketing_palette is
  'Merkevarefarger for plakat og eksport: {"primary","secondary","accent"}. NULL = klubbens farge.';

-- Plakater som allerede finnes er generert av den gamle automatikken.
update shows set poster_source = 'ai'
where poster_url is not null and poster_source is null;

-- ─────────────────────────────────────────────────────────────
-- show_marketing_designs — fra vedlegg på ett show til bibliotek
--
-- show_id null + club_id satt = mal i klubbens bibliotek.
-- show_id satt                = fil lastet opp på dette showet.
-- ─────────────────────────────────────────────────────────────
alter table show_marketing_designs
  alter column show_id drop not null;

alter table show_marketing_designs
  add column if not exists club_id    uuid references clubs(id) on delete cascade,
  add column if not exists kind       text not null default 'template',
  add column if not exists slot_count integer not null default 0,
  add column if not exists width      integer,
  add column if not exists height     integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'show_marketing_designs_kind_check') then
    alter table show_marketing_designs
      add constraint show_marketing_designs_kind_check
      check (kind in ('template', 'poster'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'show_marketing_designs_owner_check') then
    alter table show_marketing_designs
      add constraint show_marketing_designs_owner_check
      check (show_id is not null or club_id is not null);
  end if;
end $$;

comment on column show_marketing_designs.club_id is
  'Eier i biblioteket. Satt uten show_id = mal som kan brukes på alle klubbens show.';
comment on column show_marketing_designs.kind is
  '''template'' = mal AI-en redigerer. ''poster'' = ferdig plakat klubben har laget selv.';
comment on column show_marketing_designs.slot_count is
  'Antall bilderuter i malen. 0 = ukjent. Brukes til å matche malen mot lineupens størrelse.';

update show_marketing_designs d
set club_id = s.club_id
from shows s
where d.show_id = s.id
  and d.club_id is null
  and s.club_id is not null;

create index if not exists idx_show_marketing_designs_club_id
  on show_marketing_designs(club_id, kind, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- show_marketing_slots — hvilken artist og hvilket bilde som
-- hører til hver rute i malen
-- ─────────────────────────────────────────────────────────────
create table if not exists show_marketing_slots (
  id          uuid primary key default gen_random_uuid(),
  show_id     uuid not null references shows(id) on delete cascade,
  slot_index  integer not null,
  role_label  text,
  artist_id   uuid references artists(id) on delete set null,
  image_url   text,
  image_path  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (show_id, slot_index)
);

comment on table show_marketing_slots is
  'Én rad per bilderute i malen. image_url overstyrer artistens profilbilde.';

create index if not exists idx_show_marketing_slots_show
  on show_marketing_slots(show_id, slot_index);

alter table show_marketing_slots enable row level security;

drop policy if exists "Admins manage show marketing slots" on show_marketing_slots;
create policy "Admins manage show marketing slots"
  on show_marketing_slots for all
  using (is_admin());

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_show_marketing_slots_updated_at') then
    create trigger trg_show_marketing_slots_updated_at
      before update on show_marketing_slots
      for each row execute function update_updated_at();
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- show_marketing_exports — ferdige filer per format
-- ─────────────────────────────────────────────────────────────
create table if not exists show_marketing_exports (
  id                uuid primary key default gen_random_uuid(),
  show_id           uuid not null references shows(id) on delete cascade,
  format            text not null,
  file_url          text not null,
  file_path         text not null,
  width             integer not null,
  height            integer not null,
  source_poster_url text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (show_id, format)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'show_marketing_exports_format_check') then
    alter table show_marketing_exports
      add constraint show_marketing_exports_format_check
      check (format in ('facebook_event', 'social_post', 'social_story', 'print_a4', 'print_a3'));
  end if;
end $$;

comment on column show_marketing_exports.source_poster_url is
  'Plakaten filen ble laget av. Er den ulik shows.poster_url, er eksporten utdatert.';

create index if not exists idx_show_marketing_exports_show
  on show_marketing_exports(show_id, format);

alter table show_marketing_exports enable row level security;

drop policy if exists "Admins manage show marketing exports" on show_marketing_exports;
create policy "Admins manage show marketing exports"
  on show_marketing_exports for all
  using (is_admin());

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_show_marketing_exports_updated_at') then
    create trigger trg_show_marketing_exports_updated_at
      before update on show_marketing_exports
      for each row execute function update_updated_at();
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Bøtte for de eksporterte filene
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('show-marketing-exports', 'show-marketing-exports', true)
on conflict (id) do nothing;

drop policy if exists "Public read show-marketing-exports" on storage.objects;
create policy "Public read show-marketing-exports"
  on storage.objects for select
  using (bucket_id = 'show-marketing-exports');

drop policy if exists "Admin manages show-marketing-exports" on storage.objects;
create policy "Admin manages show-marketing-exports"
  on storage.objects for all
  using (bucket_id = 'show-marketing-exports' and is_admin());
