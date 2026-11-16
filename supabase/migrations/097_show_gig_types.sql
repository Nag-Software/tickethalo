-- ============================================================
-- Migrasjon 097: type gig per kveld
--
-- Klubben merker kvelden med én eller flere av Paid / Unpaid / Bringer /
-- Stayer. Komikeren ser merkene på Open spots og i bookingtilbudet
-- (ClickUp «Type gig», 2026-11-16).
--
--  - Tom liste = ikke satt. Eksisterende show får den.
--  - Bare de fire verdiene er lov. Rekkefølgen settes av appen
--    (`lib/gig-types.ts`), ikke av databasen.
-- ============================================================

alter table shows
  add column if not exists gig_types text[] not null default '{}';

alter table shows
  drop constraint if exists shows_gig_types_check;

alter table shows
  add constraint shows_gig_types_check
  check (gig_types <@ array['paid', 'unpaid', 'bringer', 'stayer']::text[]);
