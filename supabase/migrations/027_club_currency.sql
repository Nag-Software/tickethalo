-- ============================================================
-- Migration 027: Club currency
--
-- Klubben selger i én valuta. Feltet er standardverdien nye
-- show arver — showet beholder sin egen `shows.currency`, slik
-- at et bytte av klubbvaluta ikke skriver om priser som
-- allerede er solgt på.
-- ============================================================

alter table clubs
  add column if not exists currency text not null default 'NOK';

comment on column clubs.currency is
  'ISO 4217-kode. Standardvaluta for nye show i klubben.';
