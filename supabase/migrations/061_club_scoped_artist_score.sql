-- ============================================================
-- Migrasjon 061: scoren blir klubbens egen
--
-- `artists.admin_score` var ett tall per komiker, regnet på tvers av alle
-- klubber. En svak kveld i Tromsø flyttet komikeren ned i køen i Oslo også.
-- Men klubbene har ikke samme publikum: geografi og demografi gjør at den
-- som treffer ett sted, ikke treffer et annet. Det er samme feil som 043
-- rettet for roller, energi og flagg — en vurdering er ikke et faktum om
-- personen, og den hører hjemme i koblingen mellom klubb og komiker.
--
-- Scoren flyttes derfor til `club_artists.score` og regnes bare av
-- vurderingene klubben selv har gitt. En klubb som aldri har vurdert
-- komikeren, starter på nøytrale 5,0 — andre klubbers smak arves ikke.
--
-- Vurderingene i `artist_performance_reviews` har hele tiden vært lagret med
-- klubben som ga dem, så ingenting må samles inn på nytt.
--
-- `artists.admin_score` blir stående inntil videre, som kolonnene i 043. Den
-- leses og skrives ikke lenger.
-- ============================================================

alter table club_artists
  add column if not exists score numeric(3,1) not null default 5;

comment on column club_artists.score is
  'Snittet av vurderingene *denne* klubben har gitt komikeren, 0–10. Settes av lib/artist-reviews.ts, ikke for hånd. 5,0 = klubben har ikke vurdert hen ennå.';

comment on column artists.admin_score is
  'Utgått (migrasjon 061). Scoren er per klubb og ligger på club_artists.score.';

-- ─────────────────────────────────────────────────────────────
-- Backfill: samme regnestykke som `scoreFromRatings` i lib/artist-score.ts,
-- men per klubb. De ti siste vurderingene, avbud teller dobbelt, og færre
-- enn tre kvelder fylles opp med nøytrale 5.
-- ─────────────────────────────────────────────────────────────
with ranked as (
  select
    club_id,
    artist_id,
    rating,
    row_number() over (partition by club_id, artist_id order by created_at desc) as rn
  from artist_performance_reviews
  where club_id is not null
),
summed as (
  select
    club_id,
    artist_id,
    sum(
      case rating when 'strong' then 10 when 'medium' then 5 else 0 end
      * case rating when 'no_show' then 2 else 1 end
    ) as total,
    sum(case rating when 'no_show' then 2 else 1 end) as evenings
  from ranked
  where rn <= 10
  group by club_id, artist_id
)
update club_artists ca
set score = round(
  (s.total + 5 * greatest(0, 3 - s.evenings))::numeric / greatest(s.evenings, 3),
  1
)
from summed s
where s.club_id = ca.club_id
  and s.artist_id = ca.artist_id;

-- Omregningen slår opp klubbens vurderinger av én komiker, nyeste først.
create index if not exists idx_perf_reviews_club_artist_created
  on artist_performance_reviews (club_id, artist_id, created_at desc);
