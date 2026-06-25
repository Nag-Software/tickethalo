-- ============================================================
-- Migration 038: Club-scoped admin RLS  (#25)
--   is_admin() is global (any owner/admin/staff of ANY club), and the FOR ALL
--   admin policies on shows/show_requirements/booking_offers/confirmed_spots/
--   artist_payouts used `using (is_admin())` with no club predicate — so the RLS
--   layer provided zero tenant isolation. Today this is masked because all admin
--   access goes through the service-role client (which bypasses RLS) plus
--   app-level assertShowAccess(); this closes the latent gap at the RLS layer.
--
-- Superadmins keep full access; club admins are scoped to clubs they belong to
-- via club_memberships (resolved through the parent show for child tables).
-- Uses is_club_member() from migration 034. Artist SELECT policies are untouched.
--
-- Note: artist_payouts was dropped in migration 013 (payouts tracked in Stripe),
-- so it is intentionally NOT covered here.
-- ============================================================

-- ── shows (has club_id directly) ──
drop policy if exists "Admins manage shows" on shows;

create policy "Superadmin manage shows"
  on shows for all
  using (is_superadmin()) with check (is_superadmin());

create policy "Club admins manage own shows"
  on shows for all
  using (club_id is not null and is_club_member(club_id))
  with check (club_id is not null and is_club_member(club_id));

-- ── show_requirements (club via parent show) ──
drop policy if exists "Admins manage requirements" on show_requirements;

create policy "Superadmin manage requirements"
  on show_requirements for all
  using (is_superadmin()) with check (is_superadmin());

create policy "Club admins manage own requirements"
  on show_requirements for all
  using (exists (
    select 1 from shows s
    where s.id = show_requirements.show_id
      and s.club_id is not null and is_club_member(s.club_id)
  ))
  with check (exists (
    select 1 from shows s
    where s.id = show_requirements.show_id
      and s.club_id is not null and is_club_member(s.club_id)
  ));

-- ── booking_offers (artist SELECT policy left intact) ──
drop policy if exists "Admins manage all offers" on booking_offers;

create policy "Superadmin manage offers"
  on booking_offers for all
  using (is_superadmin()) with check (is_superadmin());

create policy "Club admins manage own offers"
  on booking_offers for all
  using (exists (
    select 1 from shows s
    where s.id = booking_offers.show_id
      and s.club_id is not null and is_club_member(s.club_id)
  ))
  with check (exists (
    select 1 from shows s
    where s.id = booking_offers.show_id
      and s.club_id is not null and is_club_member(s.club_id)
  ));

-- ── confirmed_spots (artist SELECT policy left intact) ──
drop policy if exists "Admins manage confirmed spots" on confirmed_spots;

create policy "Superadmin manage confirmed spots"
  on confirmed_spots for all
  using (is_superadmin()) with check (is_superadmin());

create policy "Club admins manage own confirmed spots"
  on confirmed_spots for all
  using (exists (
    select 1 from shows s
    where s.id = confirmed_spots.show_id
      and s.club_id is not null and is_club_member(s.club_id)
  ))
  with check (exists (
    select 1 from shows s
    where s.id = confirmed_spots.show_id
      and s.club_id is not null and is_club_member(s.club_id)
  ));
