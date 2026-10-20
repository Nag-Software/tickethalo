-- ============================================================
-- Migrasjon 075: komikerens score på tvers av klubbene
--
-- Scoren som styrer bookingen er klubbens egen (`club_artists.score`, 061),
-- og slik skal det være: klubbene har ikke samme publikum. Men plattformen
-- vil også kunne se hvordan en komiker gjør det samlet — for senere bruk,
-- ikke for å velge hvem som får tilbud.
--
-- Den globale scoren er det vektede snittet av klubbenes lokale score, der
-- hver klubb teller med antallet vurderinger den har gitt. Klubber som ikke
-- har vurdert komikeren, er ikke med: deres 5,0 er et utgangspunkt, ikke en
-- mening. Null = ingen klubb har vurdert hen.
--
-- Egen tabell, ikke en kolonne på `artists`: `is_admin()`-policyene lar alle
-- klubbadmins lese `artists`, og en klubb skal ikke se hva andre klubber
-- mener. Bare superadmin kan lese tabellen; den skrives bare av serveren
-- (service role) fra lib/artist-reviews.ts.
--
-- `artists.admin_score` (utgått i 061) røres ikke.
-- ============================================================

create table if not exists artist_global_scores (
  artist_id    uuid primary key references artists(id) on delete cascade,
  score        numeric(3,1),
  review_count integer not null default 0,
  club_count   integer not null default 0,
  updated_at   timestamptz not null default now()
);

comment on table artist_global_scores is
  'Komikerens score på tvers av klubbene. Bare for superadmin — bookingen bruker klubbens egen score. Settes av lib/artist-reviews.ts.';
comment on column artist_global_scores.score is
  'Snittet av klubbenes lokale score, vektet med antall vurderinger per klubb. Null = ingen vurderinger.';

alter table artist_global_scores enable row level security;

drop policy if exists "Superadmin can read global scores" on artist_global_scores;
create policy "Superadmin can read global scores"
  on artist_global_scores for select
  using (is_superadmin());

-- ─────────────────────────────────────────────────────────────
-- Backfill. Samme regnestykke som `scoreFromRatings` per klubb (som 061),
-- deretter `globalScore` i lib/artist-score.ts: vektet med alle
-- vurderingene klubben har gitt, ikke bare de ti scoren regnes over.
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
per_club as (
  select
    club_id,
    artist_id,
    count(*) as reviews,
    sum(
      case when rn <= 10 then
        case rating when 'strong' then 10 when 'medium' then 5 else 0 end
        * case rating when 'no_show' then 2 else 1 end
      else 0 end
    ) as total,
    sum(case when rn <= 10 then case rating when 'no_show' then 2 else 1 end else 0 end) as evenings
  from ranked
  group by club_id, artist_id
),
club_scores as (
  select
    artist_id,
    reviews,
    round((total + 5 * greatest(0, 3 - evenings))::numeric / greatest(evenings, 3), 1) as score
  from per_club
)
insert into artist_global_scores (artist_id, score, review_count, club_count, updated_at)
select
  artist_id,
  round(sum(score * reviews) / sum(reviews), 1),
  sum(reviews)::integer,
  count(*)::integer,
  now()
from club_scores
group by artist_id
on conflict (artist_id) do update
  set score = excluded.score,
      review_count = excluded.review_count,
      club_count = excluded.club_count,
      updated_at = excluded.updated_at;
