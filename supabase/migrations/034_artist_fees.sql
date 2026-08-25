-- ============================================================
-- Migration 034: Honorar til komikerne etter showet
--
-- Klubben er selger og sitter på billettinntekten (migrasjon 032).
-- Etter at showet er avholdt skal komikerne ha sin del av den, og
-- de skal få vite hva som kommer og hvor det sendes.
--
-- Andelen ligger på klubben, ikke i koden: en klubb som deler
-- annerledes skal være en dataendring, slik `platform_fee_bps` er.
-- Selve honoraret per spot står fortsatt i lineupen — fast beløp
-- eller prosent på `show_requirements`. Det denne migrasjonen
-- legger til er potten de skal få plass innenfor, kontonummeret
-- pengene sendes til, og et spor av at eposten er sendt.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- artists — hvor honoraret sendes
-- ─────────────────────────────────────────────────────────────
alter table artists
  add column if not exists bank_account_number text;

comment on column artists.bank_account_number is
  'Kontonummeret honoraret utbetales til. Komikeren fører det selv i '
  'portalen. Lagres som skrevet — formatet varierer med land, og et '
  'normalisert felt ville bare gjort feilskriving vanskeligere å se.';

-- ─────────────────────────────────────────────────────────────
-- clubs — komikernes andel av billettinntekten
-- ─────────────────────────────────────────────────────────────
alter table clubs
  add column if not exists artist_share_bps integer not null default 9000;

comment on column clubs.artist_share_bps is
  'Komikernes samlede andel av klubbens nettoinntekt på et show, i '
  'basispunkter. 9000 = 90 %. Taket for hva lineupen til sammen kan '
  'utløse; resten blir hos klubben. Per klubb av samme grunn som '
  'platform_fee_bps.';

alter table clubs
  drop constraint if exists clubs_artist_share_bps_check;
alter table clubs
  add constraint clubs_artist_share_bps_check
    check (artist_share_bps between 0 and 10000);

-- ─────────────────────────────────────────────────────────────
-- confirmed_spots — beløpet og kvitteringen
-- ─────────────────────────────────────────────────────────────
alter table confirmed_spots
  add column if not exists fee_email_sent_at timestamptz;

comment on column confirmed_spots.fee_email_sent_at is
  'Satt når honorar-eposten faktisk gikk ut. Er den satt, sender ikke '
  'kjøringen den om igjen — en komiker skal ikke få det samme '
  'honoraret varslet to ganger.';

comment on column confirmed_spots.fee_amount is
  'Honoraret for spoten, i minste valutaenhet. Fast avtale settes ved '
  'booking; prosentavtale kan først regnes ut når billettsalget er '
  'kjent, og skrives da av honorar-kjøringen etter showet.';

-- Kjøringen plukker spots på avholdte show som ennå ikke har fått epost.
create index if not exists idx_confirmed_spots_fee_email
  on confirmed_spots(show_id)
  where fee_email_sent_at is null;
