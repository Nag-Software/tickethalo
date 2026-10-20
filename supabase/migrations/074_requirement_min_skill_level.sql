-- ============================================================
-- Migrasjon 074: minste skill level på en lineup-plass
--
-- Bookerne ville ha nivået tilbake: Low, Medium eller High, og et krav på
-- plassen — «Low or higher», «Medium or higher», «Only High». Nivået settes
-- ikke for hånd. Det avledes av klubbens egen score (`club_artists.score`,
-- migrasjon 061) i lib/artist-score.ts: under 4 er Low, over 7 er High, og
-- alt imellom Medium. En komiker klubben ikke har vurdert ennå (5,0), er
-- Medium.
--
-- Kravet er et hardt krav, som rolle, energi og kjønn: motoren sender ikke
-- tilbud til den som ligger under, og trekker sine egne ubesvarte tilbud om
-- bookeren skjerper kravet. Det er bare den lokale scoren som teller — den
-- globale (migrasjon 075) brukes ikke i bookingen.
--
-- `club_booking_settings.min_bookable_score` (027) var en tidligere tanke
-- om det samme, per klubb og ikke per plass. Den ble aldri lest, og ble
-- slettet i 058.
-- ============================================================

alter table show_requirements
  add column if not exists min_skill_level text;

alter table show_requirements
  drop constraint if exists show_requirements_min_skill_level_check;
alter table show_requirements
  add constraint show_requirements_min_skill_level_check
    check (min_skill_level in ('low', 'medium', 'high'));

comment on column show_requirements.min_skill_level is
  'Minste skill level for plassen, avledet av klubbens score. Null eller low = alle. Se lib/artist-score.ts.';
