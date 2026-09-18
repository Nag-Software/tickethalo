-- ============================================================
-- Migrasjon 062: Plakatarkiv og bekreftede mal-layouter
--
-- To ting som henger sammen (docs/plakat-plan.md):
--
--  1. Plakater forsvant. `generateShowPoster` overskrev `shows.poster_url`
--     uten at noen rad pekte på den forrige plakaten. Nå blir hver plakat —
--     generert eller opplastet — en `kind = 'poster'`-rad i
--     `show_marketing_designs`, med kilde og lineupen den ble laget for.
--     Opplastede plakater lå der allerede; de får bare `source` fylt inn.
--
--  2. AI-en tegner ikke lenger ansikter og tekst. En mal må derfor vite hvor
--     bilderutene og tekstfeltene er. Det ligger i `poster_layout`, og
--     `layout_status = 'confirmed'` betyr at klubben har sett over og godkjent.
--     `plate_url` er malen med de feltene tømt — laget én gang, brukt av alle
--     show som velger malen.
--
-- `shows.poster_background_url` er bakgrunnen til plakaten uten mal. Den
-- beholdes slik at en endret lineup kan rendres på nytt uten et nytt AI-kall.
--
-- Ingenting slettes eller endres på eksisterende rader ut over `source`.
-- ============================================================

alter table show_marketing_designs
  add column if not exists source          text,
  add column if not exists lineup_snapshot jsonb,
  add column if not exists poster_layout   jsonb,
  add column if not exists layout_status   text not null default 'none',
  add column if not exists plate_url       text,
  add column if not exists plate_path      text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'show_marketing_designs_source_check') then
    alter table show_marketing_designs
      add constraint show_marketing_designs_source_check
      check (source is null or source in ('ai', 'upload'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'show_marketing_designs_layout_status_check') then
    alter table show_marketing_designs
      add constraint show_marketing_designs_layout_status_check
      check (layout_status in ('none', 'draft', 'confirmed'));
  end if;
end $$;

comment on column show_marketing_designs.source is
  'Bare for kind = ''poster'': ''ai'' (generert) eller ''upload'' (klubbens egen fil).';
comment on column show_marketing_designs.lineup_snapshot is
  'Lineupen plakaten ble laget for: [{"artist_id","name"}]. Avviker den fra dagens lineup, er plakaten utdatert.';
comment on column show_marketing_designs.poster_layout is
  'Bare for kind = ''template'': bilderuter og tekstfelt, se lib/poster/layout.ts.';
comment on column show_marketing_designs.layout_status is
  '''none'' = ikke satt opp, ''draft'' = foreslått av synsmodellen, ''confirmed'' = godkjent av klubben og klar til bruk.';
comment on column show_marketing_designs.plate_url is
  'Malen med bilderuter og utskiftbar tekst tømt. Alt utenfor feltene er identisk med originalfila.';

update show_marketing_designs
set source = 'upload'
where kind = 'poster' and source is null;

create index if not exists idx_show_marketing_designs_show_posters
  on show_marketing_designs(show_id, created_at desc)
  where kind = 'poster';

alter table shows
  add column if not exists poster_background_url  text,
  add column if not exists poster_background_path text;

comment on column shows.poster_background_url is
  'AI-bakgrunnen til plakaten uten mal. Gjenbrukes når lineupen endres, så ny tekst ikke krever nytt AI-kall.';
