-- ============================================================
-- Migrasjon 063: Klubben publiserer selv — varsel når lineupen er full
--
-- Showet publiserte seg selv i det siste plassen ble bekreftet. Da gikk
-- event-siden ut uten plakat, uten tekst og uten at billettsalget var satt
-- opp: lineupen var ferdig, men kvelden var ikke klar til å vises frem.
--
-- Nå stopper automatikken på `fullbooked`. Klubben får en e-post — «Line-up
-- is booked – Publish?» — og publiserer selv når siden er klar.
--
-- `lineup_full_notified_at` er stempelet som gjør at e-posten går én gang.
-- Motoren kjører etter hvert svar og hver morgen, og uten stempelet ville et
-- fullt show fått samme e-post hver dag til noen trykket Publiser. Åpner en
-- plass seg igjen før publisering, nullstilles stempelet, så klubben får
-- beskjed på nytt når lineupen er full igjen.
--
-- Show som allerede er publisert røres ikke.
-- ============================================================

alter table shows
  add column if not exists lineup_full_notified_at timestamptz;

comment on column shows.lineup_full_notified_at is
  'Når klubben fikk «Line-up is booked – Publish?». Null = ikke varslet for gjeldende lineup.';
