-- ============================================================
-- Migration 065: Club-scoped RLS for orders, tickets, customers, email_logs
--
-- Migrasjon 038 skopet shows, show_requirements, booking_offers og
-- confirmed_spots per klubb, men lot fire policyer fra 002 stå:
--
--   create policy "Admins manage orders"  on orders  for all using (is_admin());
--   create policy "Admins manage tickets" on tickets for all using (is_admin());
--   (og det samme for customers og email_logs)
--
-- `is_admin()` er global: eier/admin/staff i HVILKEN SOM HELST klubb. En
-- klubbadmin logger inn med Supabase Auth og har en `authenticated`-JWT,
-- og den publiserbare nøkkelen ligger i nettleseren. Med disse policyene
-- kunne en admin i klubb A lese — og med `for all` uten `with check` også
-- endre — klubb Bs ordrer og billetter rett mot REST-API-et.
--
-- Appen er ikke berørt: alt den gjør mot disse tabellene går gjennom
-- service role, som går utenom RLS. Dette tetter hullet i selve laget,
-- etter samme mønster som 038: superadmin alt, klubbadmin sin egen klubb.
--
-- customers og email_logs har ingen klubbkolonne og brukes bare av service
-- role. De blir superadmin-only.
-- ============================================================

-- ── orders (har club_id direkte) ──
drop policy if exists "Admins manage orders" on orders;

create policy "Superadmin manage orders"
  on orders for all
  using (is_superadmin()) with check (is_superadmin());

create policy "Club admins manage own orders"
  on orders for all
  using (club_id is not null and is_club_member(club_id))
  with check (club_id is not null and is_club_member(club_id));

-- ── tickets (klubb via showet) ──
drop policy if exists "Admins manage tickets" on tickets;

create policy "Superadmin manage tickets"
  on tickets for all
  using (is_superadmin()) with check (is_superadmin());

create policy "Club admins manage own tickets"
  on tickets for all
  using (exists (
    select 1 from shows s
    where s.id = tickets.show_id
      and s.club_id is not null and is_club_member(s.club_id)
  ))
  with check (exists (
    select 1 from shows s
    where s.id = tickets.show_id
      and s.club_id is not null and is_club_member(s.club_id)
  ));

-- ── customers / email_logs (ingen klubb — bare superadmin) ──
drop policy if exists "Admins manage customers" on customers;

create policy "Superadmin manage customers"
  on customers for all
  using (is_superadmin()) with check (is_superadmin());

-- email_logs fra 001 fantes aldri i produksjon: databasen ble satt opp for
-- hånd før migreringsverktøyet kom. Hver e-post har derfor logget «Could not
-- write email_logs», og superadmins oversikt over feilede e-poster har vært
-- tom. Tabellen lages her, identisk med 001, så sporet finnes fra nå av.
create table if not exists email_logs (
  id              uuid primary key default gen_random_uuid(),

  recipient_email text not null,
  subject         text,
  template_name   text,
  resend_email_id text,

  status          text not null default 'pending'
                    check (status in ('pending', 'sent', 'failed')),
  error_message   text,

  payload         jsonb,

  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

alter table email_logs enable row level security;

drop policy if exists "Admins manage email logs" on email_logs;
drop policy if exists "Superadmin manage email logs" on email_logs;

create policy "Superadmin manage email logs"
  on email_logs for all
  using (is_superadmin()) with check (is_superadmin());

-- Oversikten leser de siste feilede; uten indeks blir det en full skann.
create index if not exists idx_email_logs_status_created
  on email_logs (status, created_at desc);

-- ── Den offentlige show-policyen regnet «i dag» i UTC ──
-- Alt annet regner norsk dato (048, 060, lib/ticket-sales.ts). Sidene leser
-- med service role og var ikke berørt; direkte anonyme oppslag var det.
drop policy if exists "Anyone can view published shows" on shows;
create policy "Anyone can view published shows"
  on shows for select
  using (
    status = 'published'
    and deleted_at is null
    and date >= (now() at time zone 'Europe/Oslo')::date
  );

-- ── search_path på hjelpefunksjonene ──
-- security definer uten fast search_path er det Supabase-advisoren peker
-- på (function_search_path_mutable). is_club_member (034) har det alt.
alter function is_admin() set search_path = public;
alter function is_superadmin() set search_path = public;
alter function my_artist_id() set search_path = public;
