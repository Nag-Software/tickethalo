-- ============================================================
-- Migrasjon 056 (fase 4, utvid): tilbud i bølger
--
-- Motoren sendte opptil ti tilbud per sete med en gang. Da gikk plassen
-- til den som svarte først, ikke til den beste. Nå trappes den opp: to
-- tilbud per sete den første dagen, to til neste morgen, opp til ti.
--
-- Det krever tre ting den ikke hadde:
--
--  * `auto_started_at` på plassen — dagen automatikken begynte å jobbe på
--    nettopp den. Uten den vet ikke motoren hvilken bølge den er i, og et
--    show som lå i utkast i to uker ville sendt alle ti med en gang.
--  * `reminded_at` på tilbudet, så påminnelsen går én gang.
--  * `lineup_deadline_days` på klubben — når lineupen skal være klar.
--    Null betyr plattformens standard i `booking_scoring_config`, så en
--    justering der gjelder alle klubber som ikke har valgt noe selv.
-- ============================================================

alter table show_requirements
  add column if not exists auto_started_at timestamptz;

comment on column show_requirements.auto_started_at is
  'Når bookingmotoren begynte å jobbe på plassen. Styrer bølgen. Null = motoren rører den ikke.';

alter table booking_offers
  add column if not exists reminded_at timestamptz;

comment on column booking_offers.reminded_at is
  'Når påminnelsen om svarfristen gikk ut. Null = ikke sendt. Settes én gang per tilbud.';

alter table clubs
  add column if not exists lineup_deadline_days integer
  check (lineup_deadline_days is null or (lineup_deadline_days >= 1 and lineup_deadline_days <= 120));

comment on column clubs.lineup_deadline_days is
  'Antall dager før showet lineupen skal være klar. Null = plattformens standard i booking_scoring_config.';

alter table booking_scoring_config
  add column if not exists offers_per_day integer not null default 2,
  add column if not exists offer_response_days integer not null default 7,
  add column if not exists rush_days integer not null default 5,
  add column if not exists reminder_hours integer not null default 48,
  add column if not exists late_offer_response_hours integer not null default 48,
  add column if not exists lineup_deadline_days integer not null default 14;

comment on column booking_scoring_config.offers_per_day is
  'Hvor mange nye tilbud hvert ledige sete får per dag, til taket i offers_per_slot er nådd.';
comment on column booking_scoring_config.offer_response_days is
  'Svarfrist på et tilbud, i døgn. Aldri lenger enn lineup-fristen, og aldri forbi showdagen.';
comment on column booking_scoring_config.rush_days is
  'Antall dager før lineup-fristen der motoren slutter å trappe opp og sender alle tilbudene med en gang.';
comment on column booking_scoring_config.reminder_hours is
  'Timer igjen av svarfristen når komikeren får påminnelse.';
comment on column booking_scoring_config.late_offer_response_hours is
  'Svarfrist på tilbud sendt etter lineup-fristen, i timer.';
comment on column booking_scoring_config.lineup_deadline_days is
  'Plattformens standard lineup-frist. Klubber kan overstyre den med clubs.lineup_deadline_days.';

-- Plasser på show som er i gang, skal ikke stå og vente på at noen trykker
-- Start booking på nytt. De regnes som startet nå, så første bølge går ut
-- ved neste kjøring.
update show_requirements sr
set auto_started_at = now()
from shows s
where s.id = sr.show_id
  and sr.auto_started_at is null
  and sr.submissions_open is not true
  and s.deleted_at is null
  and s.status in ('booking', 'fullbooked', 'published');
