-- ============================================================
-- Migrasjon 081: kommunikasjon med lineupen
--
-- Klubben skriver til alle som står i lineupen fra Communication-fanen på
-- showet. Meldingen går på e-post (gjennom køen fra 078) og blir liggende i
-- komikerportalen, så den som ikke fant e-posten kan lese den der.
--
--  - `lineup_messages`: én rad per melding, også påminnelsen og
--    invitasjonen til gruppechatten. `campaign_id` peker på utsendelsen i
--    `email_campaigns`, der leveringen per adresse står.
--  - `lineup_message_recipients`: hvem meldingen gikk til, og når hen leste
--    den i portalen.
--  - Påminnelsen 5 dager før: på eller av per show, med klubbens standard
--    når showet ikke har tatt stilling. Den sendes én gang per plass —
--    `confirmed_spots.lineup_reminder_sent_at` — så den som bookes etter at
--    resten har fått sin, får sin neste morgen uten at resten får en til.
--  - Endringsdyttet: `shows.lineup_change_notice` husker hva som er endret
--    siden lineupen sist fikk beskjed. Se lib/lineup-changes.ts.
--  - WhatsApp-nummer på komikeren, bare med samtykke.
--
-- Alt er additivt. Koden som kjører nå leser ingen av kolonnene, og
-- påminnelsen sendes av en ny rute som ikke finnes før koden er deployet.
-- ============================================================

create table if not exists lineup_messages (
  id              uuid primary key default gen_random_uuid(),
  show_id         uuid not null references shows(id) on delete cascade,
  club_id         uuid not null references clubs(id) on delete cascade,
  kind            text not null check (kind in ('message', 'reminder', 'group_invite')),
  subject         text not null,
  body            text not null,
  -- Invitasjonslenken til gruppechatten (chat.whatsapp.com), når meldingen har en.
  group_link      text,
  sent_by         uuid references profiles(id) on delete set null,
  -- Navnet slik det sto da meldingen gikk. Null = sendt automatisk.
  sender_name     text,
  campaign_id     uuid references email_campaigns(id) on delete set null,
  recipient_count integer not null default 0,
  created_at      timestamptz not null default now()
);

comment on table lineup_messages is
  'Meldinger fra klubben til lineupen på et show. Leveringen per e-post står i email_campaign_recipients. Se migrasjon 081.';
comment on column lineup_messages.kind is
  'message = skrevet av klubben, reminder = påminnelsen 5 dager før, group_invite = lenke til gruppechatten.';

create index if not exists idx_lineup_messages_show on lineup_messages (show_id, created_at desc);

create table if not exists lineup_message_recipients (
  message_id uuid not null references lineup_messages(id) on delete cascade,
  artist_id  uuid not null references artists(id) on delete cascade,
  email      text not null,
  read_at    timestamptz,
  primary key (message_id, artist_id)
);

comment on table lineup_message_recipients is
  'Hvem en lineup-melding gikk til. read_at = åpnet i komikerportalen.';

create index if not exists idx_lineup_message_recipients_artist on lineup_message_recipients (artist_id);
-- Tallet på «Messages» i portalen telles på hver side.
create index if not exists idx_lineup_message_recipients_unread
  on lineup_message_recipients (artist_id)
  where read_at is null;

alter table shows
  add column if not exists lineup_reminder_enabled boolean,
  add column if not exists lineup_arrival_time time,
  add column if not exists lineup_change_notice jsonb,
  add column if not exists lineup_group_link text;

comment on column shows.lineup_reminder_enabled is
  'Påminnelsen til lineupen 5 dager før. Null = følg clubs.lineup_reminder_default.';
comment on column shows.lineup_arrival_time is
  'Når lineupen skal være på plass. Står i påminnelsen. Null = ikke satt.';
comment on column shows.lineup_change_notice is
  'Dato, tid eller sted som er endret etter at noen ble booket, og som lineupen ikke har fått beskjed om. { felt: { from, to } }. Null = ingenting.';
comment on column shows.lineup_group_link is
  'Siste invitasjonslenke til gruppechatten klubben sendte lineupen.';

alter table clubs
  add column if not exists lineup_reminder_default boolean not null default true;

comment on column clubs.lineup_reminder_default is
  'Om påminnelsen 5 dager før går ut på show som ikke har tatt stilling selv.';

alter table confirmed_spots
  add column if not exists lineup_reminder_sent_at timestamptz;

comment on column confirmed_spots.lineup_reminder_sent_at is
  'Når påminnelsen 5 dager før gikk til denne plassen. Settes før sending, så den aldri går to ganger.';

alter table artists
  add column if not exists whatsapp_number text,
  add column if not exists whatsapp_consent_at timestamptz;

comment on column artists.whatsapp_number is
  'WhatsApp-nummeret med landskode, bare sifre (4791234567). Synlig for klubber som booker komikeren, og for lineupen på show hen er vert for.';
comment on column artists.whatsapp_consent_at is
  'Når komikeren krysset av for at nummeret kan deles. Nummeret finnes aldri uten.';

alter table artists drop constraint if exists artists_whatsapp_requires_consent;
alter table artists
  add constraint artists_whatsapp_requires_consent
  check (whatsapp_number is null or whatsapp_consent_at is not null);

alter table lineup_messages enable row level security;
alter table lineup_message_recipients enable row level security;

drop policy if exists "Superadmin manage lineup messages" on lineup_messages;
create policy "Superadmin manage lineup messages"
  on lineup_messages for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "Club admins read own lineup messages" on lineup_messages;
create policy "Club admins read own lineup messages"
  on lineup_messages for select
  using (is_club_member(club_id));

drop policy if exists "Artists read lineup messages sent to them" on lineup_messages;
create policy "Artists read lineup messages sent to them"
  on lineup_messages for select
  using (exists (
    select 1 from lineup_message_recipients recipient
    where recipient.message_id = lineup_messages.id
      and recipient.artist_id = my_artist_id()
  ));

drop policy if exists "Superadmin manage lineup message recipients" on lineup_message_recipients;
create policy "Superadmin manage lineup message recipients"
  on lineup_message_recipients for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "Artists read own lineup message receipts" on lineup_message_recipients;
create policy "Artists read own lineup message receipts"
  on lineup_message_recipients for select
  using (artist_id = my_artist_id());
