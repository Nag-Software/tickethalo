-- ============================================================
-- Migration 021: Clubs, Club Memberships, Superadmin Role
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Add superadmin role to profiles check constraint
-- ─────────────────────────────────────────────────────────────
alter table profiles
  drop constraint if exists profiles_role_check;

alter table profiles
  add constraint profiles_role_check
    check (role in ('superadmin', 'owner', 'admin', 'staff', 'artist'));

-- ─────────────────────────────────────────────────────────────
-- clubs
-- ─────────────────────────────────────────────────────────────
create table if not exists clubs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  description text,
  logo_url    text,
  city        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- club_memberships — which profiles manage which clubs
-- ─────────────────────────────────────────────────────────────
create table if not exists club_memberships (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references clubs(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (club_id, profile_id)
);

create index if not exists idx_club_memberships_profile on club_memberships(profile_id);
create index if not exists idx_club_memberships_club    on club_memberships(club_id);

-- ─────────────────────────────────────────────────────────────
-- Add club_id to shows (nullable for backward compat)
-- ─────────────────────────────────────────────────────────────
alter table shows
  add column if not exists club_id uuid references clubs(id) on delete set null;

create index if not exists idx_shows_club_id on shows(club_id);

-- ─────────────────────────────────────────────────────────────
-- Enable RLS on new tables
-- ─────────────────────────────────────────────────────────────
alter table clubs             enable row level security;
alter table club_memberships  enable row level security;

-- ─────────────────────────────────────────────────────────────
-- Update is_admin() to include superadmin
-- ─────────────────────────────────────────────────────────────
create or replace function is_admin()
returns boolean language sql security definer as $$
  select exists (
    select 1 from profiles
    where auth_user_id = auth.uid()
      and role in ('superadmin', 'owner', 'admin', 'staff')
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- is_superadmin() helper
-- ─────────────────────────────────────────────────────────────
create or replace function is_superadmin()
returns boolean language sql security definer as $$
  select exists (
    select 1 from profiles
    where auth_user_id = auth.uid()
      and role = 'superadmin'
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- clubs RLS
-- ─────────────────────────────────────────────────────────────
create policy "Superadmin can manage clubs"
  on clubs for all
  using (is_superadmin());

create policy "Club admins can view their club"
  on clubs for select
  using (
    exists (
      select 1 from club_memberships cm
      join profiles p on p.id = cm.profile_id
      where cm.club_id = clubs.id
        and p.auth_user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- club_memberships RLS
-- ─────────────────────────────────────────────────────────────
create policy "Superadmin can manage memberships"
  on club_memberships for all
  using (is_superadmin());

create policy "Members can view own memberships"
  on club_memberships for select
  using (
    exists (
      select 1 from profiles
      where profiles.id = club_memberships.profile_id
        and profiles.auth_user_id = auth.uid()
    )
  );
