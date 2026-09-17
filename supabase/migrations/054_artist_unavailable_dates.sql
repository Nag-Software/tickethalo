-- ============================================================
-- Migrasjon 054 (fase 3, utvid): dagene komikeren ikke kan
--
-- `artist_availability` sa hvilke tre datoer komikeren helst ville jobbe.
-- Det er feil vei: en komiker er ledig som regel, og opptatt av og til.
-- Tre datoer betyr heller ikke nei til resten, så markeringen ga et
-- prioriteringspåslag og ingenting mer — og den som ikke gadd å fylle den
-- ut, havnet bakerst uten å ha sagt noe.
--
-- Her snus det: komikeren markerer dagene hen *ikke* kan, og de dagene får
-- hen aldri tilbud. Ingen øvre grense — en komiker som er på turné i tre
-- uker, skal kunne si det.
--
-- `artist_availability` fjernes i 055, etter at koden som leser den er ute.
-- ============================================================

create table if not exists artist_unavailable_dates (
  id                uuid        primary key default gen_random_uuid(),
  artist_id         uuid        not null references artists(id) on delete cascade,
  unavailable_date  date        not null,
  created_at        timestamptz not null default now(),
  unique (artist_id, unavailable_date)
);

comment on table artist_unavailable_dates is
  'Dagene komikeren har markert som opptatt. Et hardt krav i bookingmotoren: ingen tilbud på disse datoene.';

create index if not exists idx_artist_unavailable_dates_date
  on artist_unavailable_dates (unavailable_date);

create index if not exists idx_artist_unavailable_dates_artist
  on artist_unavailable_dates (artist_id);

alter table artist_unavailable_dates enable row level security;

drop policy if exists "Artist manages own unavailable dates" on artist_unavailable_dates;
create policy "Artist manages own unavailable dates"
  on artist_unavailable_dates for all
  using (artist_id = my_artist_id())
  with check (artist_id = my_artist_id());

drop policy if exists "Admins view all unavailable dates" on artist_unavailable_dates;
create policy "Admins view all unavailable dates"
  on artist_unavailable_dates for select
  using (is_admin());
