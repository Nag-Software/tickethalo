-- ============================================================
-- Migration 034: RLS hardening
--   #4  artist_club_scores / artist_performance_reviews had NO RLS at all
--       → any holder of the public anon key could read every club's private
--         scores/notes and tamper with approval flags.
--   #5  club_booking_settings + booking_scoring_config had a policy
--       USING(true) WITH CHECK(true) that (lacking a TO clause) applied to
--       PUBLIC → any authenticated user could read/overwrite booking config.
--
-- All server-side access to these tables goes through the service-role client,
-- which bypasses RLS, so these policies are about blocking DIRECT anon/auth
-- client access. Default-deny (RLS on, no permissive policy for the role) is the
-- load-bearing change; the scoped policies below are for any future admin UI
-- that uses the authenticated client.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Helper: is the current user a member (admin) of this club?
-- ─────────────────────────────────────────────────────────────
create or replace function is_club_member(target_club_id uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1
    from club_memberships cm
    join profiles p on p.id = cm.profile_id
    where cm.club_id = target_club_id
      and p.auth_user_id = auth.uid()
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- artist_club_scores  (#4) — per-club approval + score + notes
-- ─────────────────────────────────────────────────────────────
alter table artist_club_scores enable row level security;

drop policy if exists "Superadmin manages artist_club_scores" on artist_club_scores;
create policy "Superadmin manages artist_club_scores"
  on artist_club_scores for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "Club admins manage own artist_club_scores" on artist_club_scores;
create policy "Club admins manage own artist_club_scores"
  on artist_club_scores for all
  using (is_club_member(club_id))
  with check (is_club_member(club_id));

-- ─────────────────────────────────────────────────────────────
-- artist_performance_reviews  (#4) — per-show 1–10 score + notes
-- (club_id is nullable via ON DELETE SET NULL; orphaned rows are
--  reachable only by the service role, which is intended.)
-- ─────────────────────────────────────────────────────────────
alter table artist_performance_reviews enable row level security;

drop policy if exists "Superadmin manages artist_performance_reviews" on artist_performance_reviews;
create policy "Superadmin manages artist_performance_reviews"
  on artist_performance_reviews for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "Club admins manage own artist_performance_reviews" on artist_performance_reviews;
create policy "Club admins manage own artist_performance_reviews"
  on artist_performance_reviews for all
  using (club_id is not null and is_club_member(club_id))
  with check (club_id is not null and is_club_member(club_id));

-- ─────────────────────────────────────────────────────────────
-- club_booking_settings  (#5) — replace the PUBLIC-wide open policy
-- ─────────────────────────────────────────────────────────────
drop policy if exists "Service role full access on club_booking_settings" on club_booking_settings;

create policy "Superadmin manages club_booking_settings"
  on club_booking_settings for all
  using (is_superadmin()) with check (is_superadmin());

create policy "Club admins manage own booking settings"
  on club_booking_settings for all
  using (is_club_member(club_id))
  with check (is_club_member(club_id));

-- ─────────────────────────────────────────────────────────────
-- booking_scoring_config  (#5 sibling) — singleton global config.
-- Replace the PUBLIC-wide open policy with superadmin-only. The
-- service role bypasses RLS, so the booking engine keeps reading it.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "Service role full access" on booking_scoring_config;

create policy "Superadmin manages booking_scoring_config"
  on booking_scoring_config for all
  using (is_superadmin()) with check (is_superadmin());
