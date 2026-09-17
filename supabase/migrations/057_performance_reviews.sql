-- ============================================================
-- Migrasjon 057 (fase 6, utvid): vurdering etter show
--
-- `artist_performance_reviews` ble laget på `new-poster` med en skala fra
-- 1 til 10 og er tom i produksjon. Et tall fra 1 til 10 er for mye å be om
-- etter en kveld — bookeren rekker det ikke, og to bookere mener ikke det
-- samme med en sjuer. Fire valg er raskt nok til at det faktisk gjøres:
--
--   svakt 0 · middels 5 · sterkt 10 · avlyste/møtte ikke 0, teller dobbelt
--
-- `artists.admin_score` blir snittet av de siste vurderingene og må derfor
-- tåle desimaler. Alle settes til 5,0: de to som står på 8 i dag, fikk det
-- satt for hånd i en annen ordning, og ingen har gjort seg fortjent til et
-- forsprang i den nye.
-- ============================================================

alter table artist_performance_reviews
  drop column if exists score;

alter table artist_performance_reviews
  add column if not exists rating text,
  add column if not exists reviewed_by uuid references profiles(id) on delete set null;

update artist_performance_reviews set rating = 'medium' where rating is null;

alter table artist_performance_reviews
  alter column rating set not null;

alter table artist_performance_reviews
  drop constraint if exists artist_performance_reviews_rating_check;

alter table artist_performance_reviews
  add constraint artist_performance_reviews_rating_check
  check (rating in ('weak', 'medium', 'strong', 'no_show'));

comment on column artist_performance_reviews.rating is
  'Kvelden slik klubben så den: weak, medium, strong, eller no_show når komikeren avlyste eller ikke møtte.';

-- `club_id` er nullbar (ON DELETE SET NULL i 023), men en vurdering uten
-- klubb kan ingen svare for. Nye rader skal alltid ha den.
create index if not exists idx_perf_reviews_artist_created
  on artist_performance_reviews (artist_id, created_at desc);

-- Scoren er nå et snitt, ikke et heltall noen setter.
alter table artists
  alter column admin_score type numeric(3,1) using admin_score::numeric(3,1);

alter table artists
  alter column admin_score set default 5;

update artists set admin_score = 5;

comment on column artists.admin_score is
  'Snittet av komikerens siste vurderinger, 0–10. Settes av lib/artist-score.ts, ikke for hånd. 5,0 = ingen vurderinger ennå.';
