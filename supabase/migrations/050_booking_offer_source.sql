-- ============================================================
-- Migration 050: Hvem som sendte tilbudet
--
-- `bookShow` trekker ubesvarte tilbud der komikeren ikke lenger matcher
-- plassens rolle, energi eller kjønn. Det stemmer for tilbudene motoren
-- selv har sendt: endrer bookeren kravene på plassen, skal de som ikke
-- passer lenger ikke stå og vente.
--
-- Men regelen visste ikke hvem som sendte tilbudet. Velger bookeren en
-- komiker selv — «Send offer», en godtatt søknad, et tilbud flyttet til en
-- annen plass — er det nettopp fordi bookeren vet bedre enn kategorien.
-- Neste gang motoren kjørte (et svar på showet, eller en ny komiker som
-- registrerte seg hvor som helst på plattformen), ble tilbudet trukket, og
-- ingen fikk vite det.
--
--   auto    motoren sendte tilbudet
--   manual  bookeren valgte komikeren
--
-- Et manuelt tilbud trekkes bare når komikeren ikke lenger kan bookes av
-- klubben (ekskludert, flagget, fjernet fra listen, ikke godkjent), og
-- motoren fyller ikke opp setet med egne tilbud mens det venter på svar.
-- Se `pendingOffersToWithdraw` og `offerQuota` i lib/booking-rules.ts.
-- ============================================================

alter table booking_offers
  add column if not exists source text not null default 'auto'
    check (source in ('auto', 'manual'));

comment on column booking_offers.source is
  'auto = sendt av bookingmotoren. manual = bookeren valgte komikeren selv '
  '(Send offer, godtatt søknad, flyttet tilbud). Motoren trekker ikke et '
  'manuelt tilbud fordi komikeren ikke matcher plassens krav.';

-- Tilbud som ble til fra en godtatt søknad, var bookerens valg. Andre
-- manuelle tilbud fra før kolonnen fantes kan ikke skilles ut, og blir
-- stående som `auto`.
update booking_offers bo
set source = 'manual'
from show_submissions ss
where ss.booking_offer_id = bo.id
  and bo.source <> 'manual';
