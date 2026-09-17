-- ============================================================
-- Migrasjon 055 (fase 3, krymp): bort med de tre ledige datoene
--
-- Kalenderen i 054 har tatt over. `artist_availability` og bonusen den ga,
-- fjernes i hele systemet — tabellen, triggeren som holdt grensen på tre,
-- funksjonen bak den, og `availability_bonus` i motorens innstillinger.
--
-- Markeringene som finnes i dag forsvinner. De betyr det motsatte av den
-- nye kalenderen, så de kan ikke gjøres om: «jeg vil helst denne datoen»
-- er ikke det samme som «jeg kan ikke de andre».
-- ============================================================

drop trigger if exists artist_availability_max_three on artist_availability;
drop function if exists enforce_artist_availability_limit();
drop table if exists artist_availability;

alter table booking_scoring_config drop column if exists availability_bonus;
