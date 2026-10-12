-- ============================================================
-- Migration 071: Betasøknaden peker på klubben den ble til
--
-- Når superadmin oppretter klubben fra en søknad, lages kontoen til
-- klubbens e-post med én gang og søknaden settes til «godkjent». Lenken
-- tilbake til klubben lå ingen steder: superadmin måtte lete den opp i
-- klubblisten. Nå står den på søknaden, så kortet kan vise «Åpne klubben»
-- i stedet for enda en «Opprett klubb» som ville laget en til.
-- ============================================================

alter table club_beta_requests
  add column if not exists club_id uuid references clubs(id) on delete set null;

comment on column club_beta_requests.club_id is
  'Klubben som ble opprettet fra søknaden. Null til superadmin har opprettet den.';

create index if not exists idx_club_beta_requests_club
  on club_beta_requests(club_id);
