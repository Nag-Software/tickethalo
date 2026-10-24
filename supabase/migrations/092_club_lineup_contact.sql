-- ============================================================
-- Migrasjon 092: klubbens kontakt for komikerne
--
-- Lineupen ser «Club contact» i påminnelsen og i teksten som festes i
-- gruppechatten. Til nå var det `support_email` — adressen billettkjøperne
-- ser på kvitteringen. Den som booker, vil ofte nås på sin egen e-post og
-- mobil, og den skal ikke stå på kvitteringen (ClickUp 869fm99be/869fm99ff).
--
--  - `contact_email`: tom = `support_email`, som før.
--  - `contact_phone`: landskode og nummer, bare sifre (4791234567), samme
--    form som `artists.whatsapp_number`. Se lib/whatsapp.ts.
--
-- Additivt. Koden som kjører nå leser ingen av kolonnene.
-- ============================================================

alter table clubs
  add column if not exists contact_email text,
  add column if not exists contact_phone text;

comment on column clubs.contact_email is
  'E-posten komikerne i lineupen ser som klubbens kontakt. Null = support_email.';
comment on column clubs.contact_phone is
  'Telefonen komikerne i lineupen ser som klubbens kontakt. Landskode og nummer, bare sifre (4791234567).';

alter table clubs drop constraint if exists clubs_contact_phone_digits;
alter table clubs
  add constraint clubs_contact_phone_digits
  check (contact_phone is null or contact_phone ~ '^[1-9][0-9]{7,14}$');
