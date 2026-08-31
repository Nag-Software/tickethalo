-- ============================================================
-- Migration 038: Fakturagrunnlaget komikeren fakturerer på
--
-- Honoraret betales mot faktura (migrasjon 034). Klubben er
-- selger, sitter på billettinntekten og er den som betaler
-- komikeren — fakturaen går derfor til klubben. Men klubben
-- betaler etter et beløp Tickethalo har regnet ut, mot en avtale
-- Tickethalo har registrert, til en konto komikeren har ført i
-- vår portal. Da er det vi som må gjøre kravet etterprøvbart.
-- En epost med et tall i er ikke etterprøvbar.
--
-- Denne tabellen er den andre halvdelen av eposten: raden skrives
-- i samme øyeblikk som grunnlaget sendes, og holder det systemet
-- faktisk har bedt om — beløpet, komikeren, showet og kontoen slik
-- den sto den dagen. Kommer det inn en faktura, slås referansen opp
-- her. Finnes den ikke, er det ingen faktura vi har bedt om, og
-- klubben skal ikke betale den.
--
-- Én rad per spot: et honorar bestilles én gang, og `status` sier
-- hvor langt det er kommet. Er den `paid`, er kravet oppgjort — en
-- faktura til på samme referanse er en dublett, ikke et nytt krav.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- clubs — hvor komikeren sender fakturaen
-- ─────────────────────────────────────────────────────────────
alter table clubs
  add column if not exists invoice_email text;

comment on column clubs.invoice_email is
  'Adressen komikerne sender honorarfakturaen til. Egen kolonne og '
  'ikke support_email: den er kontaktadressen billettkjøpere ser, og '
  'en klubb som skiller regnskap fra publikumskontakt skal slippe å '
  'velge mellom de to. Er den tom, faller honorar-eposten tilbake på '
  'support_email.';

create table if not exists artist_fee_invoices (
  id            uuid primary key default gen_random_uuid(),

  -- Referansen som står i eposten og skal stå på fakturaen.
  -- Formen er «TH-ÅÅMM-XXXXXX» med tegn fra det samme alfabetet som
  -- billettkodene (migrasjon 037): den skal kunne leses av et menneske
  -- og skrives inn uten feil. Tilfeldig, ikke utledet av spot-id —
  -- en gyldig referanse skal ikke kunne gjettes ut fra en annen.
  reference     text not null unique,

  spot_id       uuid not null unique references confirmed_spots(id) on delete cascade,
  show_id       uuid not null references shows(id) on delete cascade,
  artist_id     uuid not null references artists(id) on delete cascade,
  -- Klubben fakturaen går til, og som betaler den. Kontrollsiden
  -- ligger i klubbportalen og henger på nettopp denne kolonnen:
  -- en klubb skal se sine egne krav og ingen andres.
  club_id       uuid references clubs(id) on delete set null,

  -- Beløpet vi har bedt om, i minste valutaenhet. Det eneste beløpet
  -- som skal betales på denne referansen. Står det noe annet på
  -- fakturaen, er det avviket som er svaret, ikke fakturaen.
  amount        integer not null check (amount > 0),
  currency      text not null default 'NOK',

  -- Avtalen slik den sto da beløpet ble regnet ut («80% of ticket
  -- sales»). Gjør at en kontroll et halvår senere kan se hvorfor
  -- beløpet ble som det ble, uten å regne showet om igjen.
  agreement     text,

  -- Kontonummeret og adressen slik de sto da grunnlaget gikk ut.
  -- Endres kontoen i profilen etterpå, skal kontrollen se at den er
  -- endret — det er nettopp der en kapret konto ville vist seg.
  bank_account_number text,
  artist_email  text,

  status        text not null default 'issued'
                  check (status in ('issued', 'received', 'approved', 'paid', 'rejected')),

  issued_at     timestamptz not null default now(),
  received_at   timestamptz,
  approved_at   timestamptz,
  paid_at       timestamptz,
  -- Hvem i klubben som satte siste status. Et beløp som er klarert
  -- til utbetaling skal ha et navn på seg.
  handled_by    uuid references profiles(id) on delete set null,
  note          text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Kontrollsiden slår opp på referanse (unique-indeksen dekker det),
-- og lister på status og dato.
create index if not exists idx_artist_fee_invoices_status
  on artist_fee_invoices(status, issued_at desc);

create index if not exists idx_artist_fee_invoices_artist
  on artist_fee_invoices(artist_id, issued_at desc);

create index if not exists idx_artist_fee_invoices_show
  on artist_fee_invoices(show_id);

-- Kontrollsiden i klubbportalen lister klubbens egne krav.
create index if not exists idx_artist_fee_invoices_club
  on artist_fee_invoices(club_id, issued_at desc);

-- RLS på, uten policyer. Radene leses og skrives bare gjennom
-- service-role-klienten på serveren — aldri fra en nettleser.
alter table artist_fee_invoices enable row level security;

comment on table artist_fee_invoices is
  'Fakturagrunnlaget som er sendt til en komiker: beløpet klubben '
  'skal betale, og sporet en innkommende faktura kontrolleres mot. '
  'Skrives av honorar-kjøringen i lib/artist-fees.ts.';

comment on column artist_fee_invoices.status is
  'issued = grunnlaget er sendt, ingen faktura mottatt. received = '
  'klubben har fått fakturaen. approved = kontrollert og klarert for '
  'betaling. paid = klubben har betalt; en ny faktura på referansen '
  'er en dublett. rejected = avvist, med begrunnelse i note.';
