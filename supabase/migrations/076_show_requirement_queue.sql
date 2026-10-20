-- ============================================================
-- Migrasjon 076: bookerens kø per lineup-plass
--
-- Bookerne var redde for å slippe en automatisk booker løs uten å se hvem
-- den skriver til, og uten å kunne si hvem som skal spørres først. I
-- «Review your line-up» setter bookeren rekkefølgen på hver plass, og kan ta
-- folk ut. Motoren følger den rekkefølgen i *hver* bølge, ikke bare den
-- første — se `spotOrder` i lib/booking-rules.ts.
--
-- En plass uten rader her rangeres av motoren selv, som før. Kvalifiserte
-- komikere bookeren ikke har plassert, kommer etter køen i motorens egen
-- rekkefølge. `removed` = bookeren har tatt komikeren ut: hen får aldri
-- tilbud på plassen.
--
-- Køen er ikke et tilsagn om tilbud. Motoren sjekker ved hver kjøring om
-- komikeren fortsatt kan (ledig, ingen kollisjon, ikke spurt fra før).
-- ============================================================

create table if not exists show_requirement_queue (
  show_requirement_id uuid not null references show_requirements(id) on delete cascade,
  artist_id           uuid not null references artists(id) on delete cascade,
  position            integer not null,
  removed             boolean not null default false,
  updated_at          timestamptz not null default now(),
  primary key (show_requirement_id, artist_id)
);

comment on table show_requirement_queue is
  'Bookerens rekkefølge per lineup-plass fra «Review your line-up». Motoren følger den i hver bølge. Ingen rader = motoren rangerer selv.';
comment on column show_requirement_queue.position is
  '1 = spørres først. Tatt-ut-rader står etter køen.';
comment on column show_requirement_queue.removed is
  'Bookeren har tatt komikeren ut av køen. Hen får aldri tilbud på plassen.';

create index if not exists idx_show_requirement_queue_position
  on show_requirement_queue (show_requirement_id, position);

alter table show_requirement_queue enable row level security;

drop policy if exists "Superadmin manage requirement queues" on show_requirement_queue;
create policy "Superadmin manage requirement queues"
  on show_requirement_queue for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "Club admins manage own requirement queues" on show_requirement_queue;
create policy "Club admins manage own requirement queues"
  on show_requirement_queue for all
  using (exists (
    select 1 from show_requirements r
    join shows s on s.id = r.show_id
    where r.id = show_requirement_queue.show_requirement_id
      and s.club_id is not null and is_club_member(s.club_id)
  ))
  with check (exists (
    select 1 from show_requirements r
    join shows s on s.id = r.show_id
    where r.id = show_requirement_queue.show_requirement_id
      and s.club_id is not null and is_club_member(s.club_id)
  ));
