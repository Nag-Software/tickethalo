-- ============================================================
-- Migration 039: Spor av utsendelsene
--
-- Grunnlaget kan sendes på nytt fra klubbportalen — en komiker
-- mister eposten, bytter adresse, eller finner den aldri. Da må
-- klubben kunne se at den faktisk gikk ut igjen, og når.
--
-- `issued_at` blir stående som den dagen kravet oppsto. Det er et
-- annet spørsmål enn når komikeren sist ble minnet på det, og
-- kontrollen leser den første: en referanse hører til showet den
-- ble laget for, ikke til siste purring.
-- ============================================================

alter table artist_fee_invoices
  add column if not exists last_sent_at timestamptz,
  add column if not exists send_count integer not null default 1;

comment on column artist_fee_invoices.last_sent_at is
  'Sist grunnlaget gikk ut på epost. Null betyr at bare '
  'førstegangsutsendelsen har vært — den står i issued_at.';

comment on column artist_fee_invoices.send_count is
  'Hvor mange ganger grunnlaget er sendt. Står det høyere enn 1, '
  'har noen purret, og det er verdt å vite når en faktura uteblir.';
