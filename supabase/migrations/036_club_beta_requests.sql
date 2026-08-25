-- ============================================================
-- Migration 036: «Request beta access» fra klubbportalen
-- ============================================================
-- Klubber kan ikke registrere seg selv under betaen. Knappene på
-- /admin-app/login pekte tidligere på en mailto-lenke — henvendelsene
-- havnet i en innboks og ingen andre steder. Nå lander de her, og vises
-- i superadmin under /superadmin/beta-requests.
-- ============================================================

create table if not exists club_beta_requests (
  id          uuid primary key default gen_random_uuid(),
  club_name   text not null,
  -- Alltid lagret i lowercase av server-handlingen, slik at unique-nøkkelen
  -- faktisk fanger opp den samme klubben som søker to ganger.
  email       text not null unique,
  -- Hvilken av knappene på siden som ble brukt ('login-hero', 'login-form',
  -- 'login-booker'). Sier noe om hvilken del av siden som selger.
  source      text,
  status      text not null default 'new'
                check (status in ('new', 'contacted', 'approved', 'declined')),
  -- Superadmins egen notat-linje på henvendelsen.
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_club_beta_requests_status
  on club_beta_requests(status, created_at desc);

-- RLS på, uten offentlige policyer. Skriving skjer bare gjennom
-- service-role-klienten i server-handlingen, aldri fra nettleseren.
alter table club_beta_requests enable row level security;
