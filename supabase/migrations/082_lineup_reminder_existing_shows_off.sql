-- ============================================================
-- Migrasjon 082: påminnelsen gjelder bare nye show
--
-- Migrasjon 081 la til påminnelsen til lineupen 5 dager før showet, på som
-- standard for alle klubber (`clubs.lineup_reminder_default`). Et show som
-- ikke har tatt stilling selv (`shows.lineup_reminder_enabled` er null),
-- følger klubben. Uten denne migrasjonen ville den første kjøringen etter
-- deploy sendt påminnelser til ekte lineuper på show som allerede var satt
-- opp — før noen klubb har sett at funksjonen finnes.
--
-- Eieren bestemte (2026-10-22) at påminnelsen bare skal gjelde show som
-- opprettes etter at funksjonen er ute. Showene som finnes nå, får derfor
-- et uttrykkelig «av». Klubben kan slå den på per show i Communication-fanen.
-- Nye show starter på null og følger klubbens standard som før.
--
-- Må kjøres før koden fra 081 deployes: cron-ruten som sender
-- påminnelsene finnes ikke før da.
-- ============================================================

update shows
set lineup_reminder_enabled = false
where lineup_reminder_enabled is null;
