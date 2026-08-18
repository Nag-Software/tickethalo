-- ============================================================
-- Migration 023: Bypåmelding fra forsiden
-- ============================================================
-- «Få beskjed om nye show i Bergen» — fanger opp besøkende som
-- ikke fant noe i kveld, og som ellers bare forsvinner.
-- ============================================================

create table if not exists city_subscribers (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  -- 'alle' når besøkende ikke har filtrert på en spesifikk by.
  -- Ikke nullable, slik at unique-nøkkelen under faktisk holder:
  -- Postgres regner NULL-er som forskjellige fra hverandre.
  city        text not null default 'alle',
  source      text,
  created_at  timestamptz not null default now(),
  unique (email, city)
);

create index if not exists idx_city_subscribers_city on city_subscribers(city);

-- RLS på, uten offentlige policyer. All skriving går gjennom
-- service-role-klienten i server-handlingen, aldri fra nettleseren.
alter table city_subscribers enable row level security;
