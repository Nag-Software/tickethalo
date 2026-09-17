-- ============================================================
-- Migrasjon 058 (fase 7, krymp): restene fra `new-poster`
--
-- Fire ting ble laget på branchen `new-poster` for en bookingmotor som
-- aldri kom inn i main. Ingenting i koden leser dem, og det nye oppsettet
-- har erstattet alt de skulle gjøre:
--
--  * `club_booking_settings` — per-klubb vekter og `min_bookable_score`.
--    Vektene er globale i `booking_scoring_config`, og minstescoren er
--    borte (052). Tabellen har én rad per klubb, alle med standardverdier.
--  * `artist_club_scores` — per-klubb score og godkjenning, 5 rader.
--    Erstattet av `club_artists` (043) og vurderingene i 057.
--  * `show_requirements.booking_mode` — 'auto' eller 'manual' per plass.
--    Erstattet av `submissions_open` og `auto_started_at`.
--  * `insert_sent_offer_if_capacity` — atomisk innsetting mot et tak per
--    bølge som ikke finnes lenger. Motoren regner taket selv.
--
-- Dette sletter data. Ingenting av det er i bruk, men det er ikke noe man
-- angrer på uten backup.
-- ============================================================

drop table if exists club_booking_settings;
drop table if exists artist_club_scores;

alter table show_requirements drop constraint if exists show_requirements_booking_mode_check;
alter table show_requirements drop column if exists booking_mode;

drop function if exists insert_sent_offer_if_capacity(uuid, uuid, uuid, integer, timestamptz, integer, text);
