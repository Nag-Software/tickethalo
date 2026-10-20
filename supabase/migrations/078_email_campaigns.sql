-- ============================================================
-- Migrasjon 078: masseutsendelser
--
-- En utsendelse til mange er ikke én e-post, men en kø. Mottakerne skrives
-- inn som `pending` når klubben trykker «Send», og `drainCampaign` i
-- lib/email/bulk.ts sender dem i biter på 100 (Resends batch-endepunkt) til
-- køen er tom. Stopper en runde — tidsbudsjettet, en lukket fane, en
-- tidsavbrudd — står resten igjen som `pending`, og neste runde fortsetter
-- der den slapp. Ingen får samme e-post to ganger: én rad per adresse.
--
-- `kind` er hva utsendelsen gjelder. 'show_promo' er «Send e-mail about show»;
-- fase 3 (lineup-kommunikasjon) legger til sine egne, med mottakere som ikke
-- står på klubbens liste (derfor er `contact_id` valgfri).
-- ============================================================

create table if not exists email_campaigns (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null references clubs(id) on delete cascade,
  show_id         uuid references shows(id) on delete set null,
  kind            text not null,
  subject         text not null,
  body            text not null,
  created_by      uuid references profiles(id) on delete set null,
  status          text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  recipient_count integer not null default 0,
  sent_count      integer not null default 0,
  failed_count    integer not null default 0,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

comment on table email_campaigns is
  'Én utsendelse til mange. Mottakerne står i email_campaign_recipients. Se migrasjon 078.';
comment on column email_campaigns.kind is
  'Hva utsendelsen gjelder: show_promo = «Send e-mail about show».';

create index if not exists idx_email_campaigns_show on email_campaigns (show_id, created_at desc);
create index if not exists idx_email_campaigns_club on email_campaigns (club_id, created_at desc);

-- To klikk på «Send» (to faner, et dobbeltklikk) skal ikke bli to utsendelser.
-- Mens én pågår for et show, kan ingen ny av samme slag starte.
create unique index if not exists email_campaigns_one_sending_per_show
  on email_campaigns (show_id, kind)
  where status = 'sending' and show_id is not null;

create table if not exists email_campaign_recipients (
  campaign_id uuid not null references email_campaigns(id) on delete cascade,
  email       text not null,
  contact_id  uuid references club_contacts(id) on delete set null,
  name        text,
  -- Mottakerens egen avmeldingslenke, tatt med når køen lages, så utsendingen
  -- ikke trenger å slå opp kontakten igjen. Null for e-post som ikke er markedsføring.
  unsubscribe_url text,
  status      text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  resend_id   text,
  error       text,
  sent_at     timestamptz,
  primary key (campaign_id, email)
);

comment on table email_campaign_recipients is
  'Køen til en utsendelse. pending = ikke sendt ennå; neste runde av drainCampaign tar den.';

create index if not exists idx_email_campaign_recipients_pending
  on email_campaign_recipients (campaign_id)
  where status = 'pending';

alter table email_campaigns enable row level security;
alter table email_campaign_recipients enable row level security;

drop policy if exists "Superadmin manage email campaigns" on email_campaigns;
create policy "Superadmin manage email campaigns"
  on email_campaigns for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "Club admins read own email campaigns" on email_campaigns;
create policy "Club admins read own email campaigns"
  on email_campaigns for select
  using (is_club_member(club_id));

drop policy if exists "Superadmin manage campaign recipients" on email_campaign_recipients;
create policy "Superadmin manage campaign recipients"
  on email_campaign_recipients for all
  using (is_superadmin()) with check (is_superadmin());
