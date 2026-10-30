-- ============================================================
-- Migrasjon 095: klubbens invitasjonslenke for komikere
--
-- Klubbene vil kunne sende én lenke til komikere de kjenner. Den som
-- registrerer seg eller logger inn via lenken, havner på klubbens liste
-- (`club_artists`) med en gang (ClickUp 869fn3w36).
--
--  - `club_artist_invites`: ett hemmelig token per klubb. «Reset link»
--    bytter tokenet, og den gamle lenken slutter å virke. Egen tabell og
--    ikke en kolonne på `clubs`: klubbene leses av offentlige sider, og et
--    token der ville vært én `select *` unna å lekke. RLS er på uten
--    policies, så bare serveren (service role) ser tokenene.
--  - `club_artists.joined_via_invite`: hvem som kom inn via lenken, så
--    Comedians-siden kan vise hvor mange det er.
--
-- Additivt. Koden som kjører nå leser ingen av delene.
-- ============================================================

create table if not exists club_artist_invites (
  club_id    uuid primary key references clubs(id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now()
);

alter table club_artist_invites enable row level security;

comment on table club_artist_invites is
  'Klubbens invitasjonslenke for komikere: /artist-app/join/<token>. Ett token per klubb; nytt token = gammel lenke død.';

alter table club_artists
  add column if not exists joined_via_invite boolean not null default false;

comment on column club_artists.joined_via_invite is
  'True når komikeren la seg selv til via klubbens invitasjonslenke, ikke via «Discover comedians».';
