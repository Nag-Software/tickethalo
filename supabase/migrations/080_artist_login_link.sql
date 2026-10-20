-- ============================================================
-- Migrasjon 080: komikerprofil på klubbinnloggingen
--
-- De fleste klubbeiere står også på scenen. I stedet for to innlogginger
-- eier nå samme auth-bruker begge sidene: klubben gjennom `profiles` og
-- `club_memberships`, komikeren gjennom `artists.auth_user_id`. Portalene
-- har en bryter når begge finnes.
--
-- Kobler eieren en komikerkonto som alt finnes, flyttes `auth_user_id` over
-- til klubbinnloggingen, og den gamle innloggingen sperres. Den slettes
-- ikke: `linked_from_auth_user_id` husker den, så «Disconnect» kan gi
-- komikeren den tilbake med det gamle passordet.
--
-- Den unike delindeksen sier det rutingen alltid har tatt for gitt — én
-- komikerprofil per innlogging (`getArtistForAuthUser` bruker
-- `maybeSingle`). Nå som en klubbinnlogging kan få en profil i tillegg, er
-- det databasen som må stoppe et dobbeltklikk, ikke koden. Produksjon hadde
-- ingen duplikater da migrasjonen ble skrevet (2026-10-20).
--
-- Begge deler er additive: koden som kjører nå leser ikke kolonnen, og
-- lager aldri to profiler på én innlogging.
-- ============================================================

alter table artists
  add column if not exists linked_from_auth_user_id uuid references auth.users(id) on delete set null;

comment on column artists.linked_from_auth_user_id is
  'Komikerens egen (sperrede) innlogging mens profilen er koblet til en klubbinnlogging. «Disconnect» flytter profilen tilbake hit og opphever sperren.';

create unique index if not exists artists_auth_user_id_key
  on artists(auth_user_id)
  where auth_user_id is not null;
