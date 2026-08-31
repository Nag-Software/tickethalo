-- ============================================================
-- Migration 040: Lenken i honorar-eposten
--
-- Eposten var et helt fakturagrunnlag: beløp, referanse, mottaker,
-- org.nr, adresse og kontonummer i én tabell. Alt sammen er riktig,
-- og det er nettopp problemet — en komiker som skal skrive én
-- faktura må lese seg gjennom ni rader for å finne de tre tallene
-- som betyr noe.
--
-- Nå er eposten en setning og en lenke. Detaljene står på en side
-- komikeren kan gå tilbake til, som viser status underveis, og som
-- ikke blir utdatert i innboksen når kontonummeret endres.
--
-- Tokenet er en hemmelighet, ikke en referanse: 32 tilfeldige
-- bytes, samme form som booking_offers.token (migrasjon 001).
-- Referansen skal kunne leses opp over telefon; denne skal ikke
-- kunne gjettes.
-- ============================================================

alter table artist_fee_invoices
  add column if not exists token text unique not null
    default encode(gen_random_bytes(32), 'hex');

comment on column artist_fee_invoices.token is
  'Hemmeligheten i lenken til /fee/[token]. Gir innsyn i ett '
  'honorar uten innlogging — som booking_offers.token. Ikke det '
  'samme som reference, som står på fakturaen og er ment å leses.';
