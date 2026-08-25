-- ============================================================
-- Migration 035: Discover comedians
--
-- Klubben skal kunne bla i alle komikere på Tickethalo, ikke
-- bare sine egne, og knytte dem til seg. To ting mangler for
-- det: en kobling mellom klubb og komiker, og et tall for hvor
-- mye komikeren spiller.
--
-- Katalogen skal tåle flere hundre rader med sortering og
-- sidevisning. Da må antall bookinger ligge i samme relasjon
-- det sorteres på — ellers blir det én tellespørring per kort.
-- Samme grep som `show_ticket_counts` i migrasjon 031.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- club_artists — komikerne klubben har knyttet til seg
-- ─────────────────────────────────────────────────────────────
create table if not exists club_artists (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  artist_id uuid not null references artists(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (club_id, artist_id)
);

comment on table club_artists is
  'Komikere en klubb har knyttet til seg fra katalogen. Koblingen sier '
  'ingenting om booking — den er klubbens egen liste over hvem de '
  'jobber med.';

alter table club_artists enable row level security;

drop policy if exists "Admins manage club artists" on club_artists;
create policy "Admins manage club artists"
  on club_artists for all
  using (is_admin());

create index if not exists idx_club_artists_club on club_artists(club_id);
create index if not exists idx_club_artists_artist on club_artists(artist_id);

-- ─────────────────────────────────────────────────────────────
-- artist_directory — raden katalogen sorterer og blar i
-- ─────────────────────────────────────────────────────────────
create or replace view artist_directory
  with (security_invoker = true)
as
select
  a.id,
  a.full_name,
  a.stage_name,
  a.profile_image_url,
  a.city,
  a.country,
  a.category,
  a.status,
  a.created_at,
  coalesce(spots.bookings, 0)::int as bookings
from artists a
left join (
  select artist_id, count(*) as bookings
  from confirmed_spots
  where status in ('confirmed', 'completed', 'paid')
  group by artist_id
) spots on spots.artist_id = a.id;

comment on view artist_directory is
  'Komikerkatalogen: profilfeltene pluss antall spilte/bekreftede spots. '
  'Finnes for at «Discover comedians» kan sortere på popularitet og '
  'sidevise i én spørring.';
