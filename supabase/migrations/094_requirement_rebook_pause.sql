-- ============================================================
-- Migrasjon 094: plassen venter på bookeren etter en fjerning
--
-- Når bookeren tok en komiker ut av lineupen, startet motoren en ny runde
-- med tilbud av seg selv. Bookeren vil heller velge: plukke selv, eller
-- la motoren booke på nytt (ClickUp 869fn3vwn).
--
-- `rebook_paused_at` settes når komikeren fjernes. Så lenge den står, sender
-- motoren ingen tilbud på plassen — heller ikke den daglige kjøringen.
-- «Auto-book new» nuller den og starter bølgen forfra.
--
-- En egen kolonne og ikke en nullet `auto_started_at`: Start booking og
-- forslaget fyller inn en tom `auto_started_at`, og da ville plassen stille
-- begynt å sende igjen.
--
-- Additivt. Koden som kjører nå leser ikke kolonnen.
-- ============================================================

alter table show_requirements
  add column if not exists rebook_paused_at timestamptz;

comment on column show_requirements.rebook_paused_at is
  'Satt når bookeren fjernet en komiker. Motoren rører ikke plassen før bookeren velger «Auto-book new».';
