-- ============================================================
-- Migrasjon 060: showet får et sted, ikke bare en adresselinje
--
-- `shows` har hele tiden hadde to kolonner — `venue_name` og
-- `venue_address` — men skjemaet hadde ett felt («Venue / address») som
-- skrev til adressen, og alle tre skrivestedene satte `venue_name` til
-- null. Komikeren fikk derfor «Venue: Coming» på et show med full adresse.
-- Lokasjonene klubben fører under My club (`club_locations`, migrasjon 026)
-- ble aldri brukt av showene i det hele tatt.
--
--  1. `shows.club_location_id` — lenken til den lagrede lokasjonen.
--     `venue_name` og `venue_address` blir stående som showets egen kopi:
--     en billett og en e-post skal si hvor showet VAR, også etter at klubben
--     har slettet eller døpt om lokasjonen, og et gjestespill et annet sted
--     skal ikke trenge en lagret lokasjon. Slettes lokasjonen, løses bare
--     lenken (`on delete set null`) — kopien står.
--
--  2. **Lenken holder kopien oppdatert.** Rettes navnet eller adressen under
--     My club, følger alle kommende, lenkede show med. Det er hele poenget
--     med å lenke: en skrivefeil i adressen rettes ett sted. Spilte og
--     arkiverte show røres ikke — de er historikk. Dette er en trigger og
--     ikke appkode, så det gjelder uansett hvem som skriver raden.
--
--  3. **Utfylling av det som finnes.** Et show der den ene linja vi har
--     stemmer med en av klubbens lokasjoner — på adresse eller på navn —
--     lenkes og får navnet sitt. Resten står urørt; leseregelen i
--     `lib/show-venue.ts` viser adressen som sted når navnet mangler.
-- ============================================================

alter table shows
  add column if not exists club_location_id uuid references club_locations(id) on delete set null;

comment on column shows.club_location_id is
  'Lokasjonen fra My club showet er lenket til. venue_name/venue_address er '
  'showets kopi og følger lenken for kommende show (se sync_shows_with_club_location).';

create index if not exists idx_shows_club_location
  on shows(club_location_id)
  where club_location_id is not null;

-- ─────────────────────────────────────────────────────────────
-- 2. Lenken holder kopien oppdatert
-- ─────────────────────────────────────────────────────────────
create or replace function sync_shows_with_club_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name
     or new.address_line is distinct from old.address_line then
    update shows
    set venue_name = new.name,
        venue_address = new.address_line
    where club_location_id = new.id
      and deleted_at is null
      and date >= (now() at time zone 'Europe/Oslo')::date;
  end if;

  return new;
end;
$$;

comment on function sync_shows_with_club_location is
  'Kommende, lenkede show følger lokasjonen når navn eller adresse endres '
  'under My club. Spilte og arkiverte show røres ikke.';

drop trigger if exists trg_club_locations_sync_shows on club_locations;
create trigger trg_club_locations_sync_shows
  after update of name, address_line on club_locations
  for each row execute function sync_shows_with_club_location();

-- ─────────────────────────────────────────────────────────────
-- 3. Utfylling
--
-- Én lokasjon per show: stemmer flere, vinner den som står øverst under
-- My club. Sammenligningen ser bort fra store/små bokstaver og luft i endene.
-- ─────────────────────────────────────────────────────────────
with matched as (
  select distinct on (s.id)
    s.id as show_id,
    l.id as location_id,
    l.name,
    l.address_line,
    lower(btrim(coalesce(s.venue_address, ''))) = lower(btrim(l.name)) as address_was_the_name
  from shows s
  join club_locations l on l.club_id = s.club_id
  where s.club_location_id is null
    and (
      (btrim(coalesce(s.venue_address, '')) <> ''
        and lower(btrim(s.venue_address)) in (lower(btrim(coalesce(l.address_line, ''))), lower(btrim(l.name))))
      or (btrim(coalesce(s.venue_name, '')) <> ''
        and lower(btrim(s.venue_name)) = lower(btrim(l.name)))
    )
  order by s.id, l.sort_order, l.created_at
)
update shows s
set club_location_id = m.location_id,
    venue_name = m.name,
    -- Sto navnet i adressefeltet, er det ikke en adresse. Har lokasjonen
    -- ingen adresse selv, beholder showet den det hadde.
    venue_address = case
      when m.address_line is not null then m.address_line
      when m.address_was_the_name then null
      else s.venue_address
    end
from matched m
where s.id = m.show_id;
