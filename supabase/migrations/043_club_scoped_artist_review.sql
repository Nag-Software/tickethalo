-- ============================================================
-- Migration 043: Vurderingen av komikeren blir klubbens egen
--
-- Roller, energinivå, notater og flagg lå som kolonner på `artists` —
-- én rad delt av hele plattformen. Flagget én klubb en komiker, så alle
-- andre flagget. Mente to klubber ulikt om hvem som er headliner, kunne
-- bare den ene ha rett.
--
-- Det er en vurdering, ikke et faktum om personen, og den hører hjemme i
-- koblingen mellom klubb og komiker.
--
-- Skillet som blir stående:
--   artists.category            komikerens egen beskrivelse, fra søknaden,
--                               og det de offentlige sidene viser
--   club_artists.category       hva *denne* klubben booker hen som — det
--                               bookingmotoren matcher mot show-kravene
--
--   artists.status              plattformnivå, superadmin. En klubb skal
--                               ikke kunne avvise en komiker for alle andre.
--   artists.admin_score         systemsatt, global (migrasjon 041)
--
-- Kolonnene på `artists` blir stående inntil videre. De leses ikke lenger
-- av klubbflatene, men et `drop column` er ikke reverserbart, og
-- backfillen under er eneste kopi av dagens verdier.
-- ============================================================

alter table club_artists
  add column if not exists category text[],
  add column if not exists admin_energy_level text,
  add column if not exists admin_notes text,
  add column if not exists is_flagged boolean not null default false,
  add column if not exists flag_reason text,
  add column if not exists flagged_at timestamptz;

comment on column club_artists.category is
  'Rollene klubben booker komikeren i. Settes når komikeren knyttes til '
  'klubben. Komikerens egen beskrivelse ligger på artists.category.';

comment on column club_artists.admin_energy_level is
  'Klubbens vurdering av energinivå. Null = ikke vurdert ennå.';

comment on column club_artists.is_flagged is
  'Flagget hos denne klubben. Skjuler komikeren fra klubbens booking, '
  'og bare den.';

-- ─────────────────────────────────────────────────────────────
-- Backfill: dagens globale vurdering blir hver klubbs utgangspunkt.
-- Uten dette mister eksisterende koblinger roller og energi, og
-- bookingmotoren finner ingen kandidater dagen dette rulles ut.
-- ─────────────────────────────────────────────────────────────
update club_artists ca
set
  category           = coalesce(ca.category, a.category),
  admin_energy_level = coalesce(ca.admin_energy_level, a.admin_energy_level),
  admin_notes        = coalesce(ca.admin_notes, a.admin_notes),
  is_flagged         = ca.is_flagged or a.is_flagged,
  flag_reason        = coalesce(ca.flag_reason, a.flag_reason),
  flagged_at         = coalesce(ca.flagged_at, a.flagged_at)
from artists a
where a.id = ca.artist_id;

-- Motoren filtrerer på klubb + flagg for hvert show.
create index if not exists idx_club_artists_club_flagged
  on club_artists(club_id) where is_flagged = false;
