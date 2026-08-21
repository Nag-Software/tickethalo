-- ============================================================
-- Migration 026: Club locations + brand colour
--
-- A club is no longer tied to a single venue. `club_locations`
-- holds every room the club plays, and the public club page
-- (/clubs/<slug>) lists them.
--
-- `clubs.brand_color` is derived from the uploaded logo and
-- tints the public club page. NULL means "use the default
-- Tickethalo accent".
--
-- The old single-venue columns (clubs.location_name,
-- clubs.address_line) are copied into club_locations and are
-- no longer read by the app. They are left in place on purpose
-- so this migration stays non-destructive.
-- ============================================================

alter table clubs
  add column if not exists brand_color text;

comment on column clubs.brand_color is
  'Hex (#rrggbb) tint for the public club page, derived from the logo on upload.';

comment on column clubs.location_name is
  'Deprecated by migration 026 — replaced by club_locations.';
comment on column clubs.address_line is
  'Deprecated by migration 026 — replaced by club_locations.';

-- ─────────────────────────────────────────────────────────────
-- club_locations — a club can play several rooms
-- ─────────────────────────────────────────────────────────────
create table if not exists club_locations (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references clubs(id) on delete cascade,
  name         text not null,
  address_line text,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_club_locations_club
  on club_locations(club_id, sort_order, created_at);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_club_locations_updated_at'
  ) then
    create trigger trg_club_locations_updated_at
      before update on club_locations
      for each row execute function update_updated_at();
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Carry the existing single venue over, once
-- ─────────────────────────────────────────────────────────────
insert into club_locations (club_id, name, address_line, sort_order)
select
  c.id,
  coalesce(nullif(btrim(c.location_name), ''), nullif(btrim(c.address_line), '')),
  nullif(btrim(c.address_line), ''),
  0
from clubs c
where coalesce(nullif(btrim(c.location_name), ''), nullif(btrim(c.address_line), '')) is not null
  and not exists (select 1 from club_locations l where l.club_id = c.id);

-- ─────────────────────────────────────────────────────────────
-- RLS — mirrors the clubs table
-- ─────────────────────────────────────────────────────────────
alter table club_locations enable row level security;

drop policy if exists "Superadmin can manage club locations" on club_locations;
create policy "Superadmin can manage club locations"
  on club_locations for all
  using (is_superadmin());

drop policy if exists "Club admins can view their locations" on club_locations;
create policy "Club admins can view their locations"
  on club_locations for select
  using (
    exists (
      select 1 from club_memberships cm
      join profiles p on p.id = cm.profile_id
      where cm.club_id = club_locations.club_id
        and p.auth_user_id = auth.uid()
    )
  );
