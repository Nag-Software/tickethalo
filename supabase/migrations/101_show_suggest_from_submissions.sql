-- ============================================================
-- Migrasjon 101: forslag til lineup fra søknadene
--
-- Tom (2026-11-16): «Suggest line-up based on submissions». Klubben krysser
-- av på Submissions- eller Lineup-fanen, og komikerne som har søkt på showet,
-- foreslås til plassene som passer profilen deres.
--
--  - Av som standard: show som finnes, oppfører seg som før.
--  - Én kolonne, så avkrysningen på de to fanene alltid står likt.
-- ============================================================

alter table shows
  add column if not exists suggest_from_submissions boolean not null default false;

comment on column shows.suggest_from_submissions is
  'Søkerne foreslås til plassene som passer dem, og plasser åpne for søknader tas med i forslaget. Se lib/booking-engine.ts.';
