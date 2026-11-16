-- ============================================================
-- Migrasjon 100: klubbens egne spot-typer
--
-- Tom (prosjektleder, 2026-11-16): klubbene velger fra en standardliste og
-- kan legge til egne typer. Standardlista er Host / MC, Opener / Bullet,
-- Middle / Feature, Showcase Spot, Open Spot og Closer / Headliner.
-- «Opener er kun den første på en lineup», så dagens Stand-up er
-- Middle / Feature.
--
--  - `club_spot_types`: én rad per type per klubb. Standardtypene har en
--    `standard_key` og kan skrus av, men ikke døpes om — da kan de
--    sammenlignes på tvers av klubber. Egne typer har `standard_key` null.
--  - Nøklene er de samme verdiene `club_artists.category` alltid har lagret
--    (`konferansier`, `stand-up`, `open mic`, `headliner`), pluss to nye
--    (`opener`, `showcase`). Komikernes roller skrives derfor ikke om, og
--    show som er i gang matcher nøyaktig som før.
--  - `is_unpaid`: tilbudet sier at plassen er ubetalt. På for Open Spot.
--  - Eksisterende klubber får standardlista her; nye klubber får den første
--    gang typene leses (`lib/spot-types.ts`).
--  - Bare utkast som ikke er spilt, får de nye navnene på plassene. Show i
--    booking, lagt ut eller spilt, og søknader, tilbud og bookinger, røres
--    ikke (Casper, 2026-11-16).
--
-- RLS er på uten policies: bare serveren (service role) leser tabellen.
-- ============================================================

create table if not exists club_spot_types (
  id                           uuid primary key default gen_random_uuid(),
  club_id                      uuid not null references clubs(id) on delete cascade,
  standard_key                 text,
  name                         text not null,
  position                     integer not null default 0,
  active                       boolean not null default true,
  is_unpaid                    boolean not null default false,
  default_compensation_percent numeric(5,2),
  created_at                   timestamptz not null default now(),
  constraint club_spot_types_standard_key_check
    check (standard_key is null or standard_key in ('konferansier', 'opener', 'stand-up', 'showcase', 'open mic', 'headliner')),
  constraint club_spot_types_name_check check (length(btrim(name)) between 1 and 40),
  constraint club_spot_types_percent_check
    check (default_compensation_percent is null or (default_compensation_percent >= 0 and default_compensation_percent <= 100))
);

create unique index if not exists club_spot_types_standard_unique
  on club_spot_types (club_id, standard_key) where standard_key is not null;

create unique index if not exists club_spot_types_name_unique
  on club_spot_types (club_id, lower(btrim(name)));

create index if not exists club_spot_types_club_idx on club_spot_types (club_id, position);

alter table club_spot_types enable row level security;

comment on table club_spot_types is
  'Spot-typene klubben bruker i lineupen. standard_key = en av plattformens seks; null = klubbens egen type. Se lib/spot-types.ts.';

-- Standardlista for klubbene som finnes.
insert into club_spot_types (club_id, standard_key, name, position, is_unpaid, default_compensation_percent)
select c.id, s.standard_key, s.name, s.position, s.is_unpaid, s.percent
from clubs c
cross join (values
  ('konferansier', 'Host / MC',          1, false, 15),
  ('opener',       'Opener / Bullet',    2, false, 10),
  ('stand-up',     'Middle / Feature',   3, false, 10),
  ('showcase',     'Showcase Spot',      4, false, 10),
  ('open mic',     'Open Spot',          5, true,  0),
  ('headliner',    'Closer / Headliner', 6, false, 15)
) as s(standard_key, name, position, is_unpaid, percent)
on conflict do nothing;

-- Nye navn bare på utkast som ikke er spilt. Alt annet står som det er.
update show_requirements r
set role_name = case lower(btrim(r.role_name))
    when 'host'       then 'Host / MC'
    when 'headliner'  then 'Closer / Headliner'
    when 'open mic'   then 'Open Spot'
    when 'stand-up'   then 'Middle / Feature'
  end
from shows s
where s.id = r.show_id
  and s.status = 'draft'
  and s.deleted_at is null
  and s.date >= current_date
  and lower(btrim(r.role_name)) in ('host', 'headliner', 'open mic', 'stand-up');
