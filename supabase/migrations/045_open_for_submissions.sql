-- ============================================================
-- Migration 045: Open for submissions
--
-- Booking har til nå gått én vei: klubben sender et tilbud, komikeren
-- svarer ja eller nei. Nå skal en lineup-plass kunne stå åpen, og
-- komikeren selv melde seg på den.
--
-- En søknad er ikke et tilbud, og skal ikke ligge i `booking_offers`:
--   booking_offers   klubben har bestemt seg. `accepted` skriver rett
--                    inn i `confirmed_spots` — den er bindende.
--   show_submissions komikeren har meldt seg. Ingenting er bestemt før
--                    bookeren godtar, og da er det et vanlig tilbud som
--                    går ut.
--
-- Ville vi gjenbrukt `booking_offers`, måtte hver eneste sjekk i
-- `lib/actions/booking.ts` lært forskjellen på «klubben tilbyr» og
-- «komikeren spør». Verre: 40 påmeldte på 6 plasser ville vært 40
-- bindende tilbud, og fylt-sjekken i `sendManualBookingOffer` er ikke
-- en lås — den leser en telling.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Hvem showet er åpent for
--
-- Klubbens eget publikum er standarden: `club_artists` er allerede
-- grensen for hvem klubben kan booke (`lib/club-artists.ts`), og et
-- show som plutselig tok imot søknader fra hele Tickethalo uten at
-- noen ba om det ville vært en overraskelse, ikke en funksjon.
-- ─────────────────────────────────────────────────────────────
alter table shows
  add column if not exists submissions_audience text not null default 'roster'
    check (submissions_audience in ('roster', 'everyone'));

comment on column shows.submissions_audience is
  'Hvem som kan søke på de åpne plassene. roster = komikere klubben har '
  'i club_artists. everyone = alle godkjente komikere på Tickethalo. '
  'Sier ingenting om hvilke plasser som er åpne — det står på '
  'show_requirements.submissions_open.';

-- ─────────────────────────────────────────────────────────────
-- Når det stenger
--
-- Uten denne tar showet imot søknader til showdagen, og bookeren sitter
-- med en liste som aldri blir ferdig. Den står på showet, ikke rollen:
-- fristen er en policy, på linje med publikummet — og en booker som
-- faktisk trenger ulik frist per rolle kan få en overstyring senere
-- uten at denne kolonnen er i veien.
--
-- Null = ingen frist. Feeden stenger uansett når showet ikke lenger er
-- i `booking`, så null betyr «til showet er bemannet», ikke «for alltid».
-- ─────────────────────────────────────────────────────────────
alter table shows
  add column if not exists submissions_close_at timestamptz;

comment on column shows.submissions_close_at is
  'Siste tidspunkt en søknad kan sendes. Null = ingen frist satt. '
  'Stenger bare nye søknader — de som ligger der behandles som før.';

-- ─────────────────────────────────────────────────────────────
-- Hvilke plasser som er åpne
--
-- Per rolle, ikke per show: komikeren skal se *hva* hen søker på før
-- hen trykker. «Åpen for søknader» uten rolle er en henvendelse, ikke
-- en søknad på en plass.
-- ─────────────────────────────────────────────────────────────
alter table show_requirements
  add column if not exists submissions_open boolean not null default false;

comment on column show_requirements.submissions_open is
  'Plassen tar imot søknader fra komikere. Uavhengig av bookingmotoren: '
  'en åpen plass kan fortsatt få tilbud sendt automatisk.';

create index if not exists idx_show_requirements_submissions_open
  on show_requirements(show_id)
  where submissions_open;

-- ─────────────────────────────────────────────────────────────
-- show_submission_invitations — «vil du opptre?»
--
-- Invitasjonen er ikke et tilbud og ikke en søknad. Den er en lenke
-- klubben sender til komikerne sine, som lar komikeren søke uten å
-- logge inn — `artists.auth_user_id` er nullbar, så mange av dem har
-- ingen portalkonto. Samme grunn som `booking_offers.token` finnes.
-- ─────────────────────────────────────────────────────────────
create table if not exists show_submission_invitations (
  id           uuid primary key default gen_random_uuid(),
  show_id      uuid not null references shows(id) on delete cascade,
  artist_id    uuid not null references artists(id) on delete cascade,

  token        text unique not null default encode(gen_random_bytes(32), 'hex'),

  sent_at      timestamptz,
  opened_at    timestamptz,
  -- Invitasjonen dør med showet, ikke på en egen klokke.
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Én invitasjon per komiker per show. Sender bookeren ut på nytt,
  -- er det samme lenke som gjelder — ikke en ny.
  unique (show_id, artist_id)
);

comment on table show_submission_invitations is
  'Klubbens invitasjon til egne komikere om å søke på et show. Lenken '
  'lar komikeren søke uten portalkonto. Gir ingen plass i seg selv.';

create index if not exists idx_submission_invitations_show
  on show_submission_invitations(show_id);
create index if not exists idx_submission_invitations_artist
  on show_submission_invitations(artist_id);

-- ─────────────────────────────────────────────────────────────
-- show_submissions — komikeren har meldt seg på en plass
-- ─────────────────────────────────────────────────────────────
create table if not exists show_submissions (
  id                   uuid primary key default gen_random_uuid(),
  show_id              uuid not null references shows(id) on delete cascade,
  -- Alltid en rolle. Slettes rollen, faller søknaden med den: det finnes
  -- ikke lenger noe å ha søkt på.
  show_requirement_id  uuid not null references show_requirements(id) on delete cascade,
  artist_id            uuid not null references artists(id) on delete cascade,

  source               text not null default 'open_call'
                         check (source in ('open_call', 'invitation')),
  invitation_id        uuid references show_submission_invitations(id) on delete set null,

  -- `filled_by_other` speiler `booking_offers`: fylles plassen av noen
  -- andre, skal de som står og venter ikke bli liggende som `pending` i
  -- bookerens liste over noe som ikke lenger finnes.
  status               text not null default 'pending'
                         check (status in ('pending', 'shortlisted', 'accepted', 'declined', 'withdrawn', 'filled_by_other')),

  -- Komikerens egen setning til bookeren. Valgfri — ett klikk skal holde.
  message              text,

  -- Tilbudet som gikk ut da bookeren godtok søknaden. Det er her
  -- søknaden slutter og den vanlige bookingflyten tar over.
  booking_offer_id     uuid references booking_offers(id) on delete set null,

  responded_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Én søknad per komiker per plass. Dobbeltklikk på knappen skal ikke
  -- gi bookeren to like rader å ta stilling til.
  unique (show_requirement_id, artist_id)
);

comment on table show_submissions is
  'Komikeren har meldt seg på en åpen lineup-plass. Ikke bindende for '
  'noen: bookeren godtar, og da går et vanlig booking_offer ut.';

comment on column show_submissions.booking_offer_id is
  'Tilbudet søknaden ble til. Null så lenge søknaden ikke er godtatt.';

comment on column show_submissions.status is
  'pending = venter på bookeren. shortlisted = bookerens egen huskeliste. '
  'accepted = tilbud sendt. declined = bookeren sa nei. '
  'withdrawn = komikeren trakk seg. filled_by_other = plassen ble fylt '
  'av en annen mens søknaden lå der.';

create index if not exists idx_show_submissions_show
  on show_submissions(show_id);
create index if not exists idx_show_submissions_requirement
  on show_submissions(show_requirement_id);
create index if not exists idx_show_submissions_artist
  on show_submissions(artist_id);
-- Bookerens liste: de ubesvarte først, eldste øverst.
create index if not exists idx_show_submissions_pending
  on show_submissions(show_id, created_at)
  where status = 'pending';

-- ─────────────────────────────────────────────────────────────
-- updated_at-triggere (samme mønster som migrasjon 026 og 032)
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_show_submissions_updated_at') then
    create trigger trg_show_submissions_updated_at
      before update on show_submissions
      for each row execute function update_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_show_submission_invitations_updated_at') then
    create trigger trg_show_submission_invitations_updated_at
      before update on show_submission_invitations
      for each row execute function update_updated_at();
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- RLS
--
-- Alle flatene går gjennom service-role (`createAdminClient`), også de
-- offentlige. Policyene her er beltet: en komiker skal se sine egne
-- søknader og ingen andres, om noe senere leser med brukerens klient.
-- ─────────────────────────────────────────────────────────────
alter table show_submissions enable row level security;
alter table show_submission_invitations enable row level security;

drop policy if exists "Artist can view own submissions" on show_submissions;
create policy "Artist can view own submissions"
  on show_submissions for select
  using (artist_id = my_artist_id());

drop policy if exists "Admins manage submissions" on show_submissions;
create policy "Admins manage submissions"
  on show_submissions for all
  using (is_admin());

drop policy if exists "Artist can view own invitations" on show_submission_invitations;
create policy "Artist can view own invitations"
  on show_submission_invitations for select
  using (artist_id = my_artist_id());

drop policy if exists "Admins manage submission invitations" on show_submission_invitations;
create policy "Admins manage submission invitations"
  on show_submission_invitations for all
  using (is_admin());
