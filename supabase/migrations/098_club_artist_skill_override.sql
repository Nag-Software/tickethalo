-- ============================================================
-- Migrasjon 098: klubben kan sette skill level selv
--
-- Nivået (Low / Medium / High) avledes av klubbens score, og en komiker
-- ingen har vurdert ennå står på 5,0 = Medium. Klubben kjenner ofte
-- komikeren fra før og vil sette nivået med en gang, uten å vente på
-- vurderinger etter show (ClickUp «Endre skill-level på artist», 2026-11-16).
--
--  - Null = Auto: nivået følger scoren som før.
--  - Satt = klubbens valg vinner over scoren, både i visningen og når
--    motoren sjekker minstekravet på en plass. Scoren regnes fortsatt ut og
--    styrer rekkefølgen i køen.
--  - Per klubb, som resten av vurderingen.
-- ============================================================

alter table club_artists
  add column if not exists skill_level_override text;

alter table club_artists
  drop constraint if exists club_artists_skill_level_override_check;

alter table club_artists
  add constraint club_artists_skill_level_override_check
  check (skill_level_override is null or skill_level_override in ('low', 'medium', 'high'));
