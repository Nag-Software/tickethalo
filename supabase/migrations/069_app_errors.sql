-- ============================================================
-- Migration 069: Feilmeldinger samlet ett sted
--
-- Feil i kjøp, billettepost, Stripe-webhooken og cron-jobbene gikk bare til
-- console.error, altså Vercel-loggen, som ruller ut etter noen dager og som
-- ingen ser uten å lete. En kunde som ikke fikk billetten sin var usynlig
-- til hen skrev til oss.
--
-- Nå skriver `recordError` i lib/error-log.ts hver slik feil hit, med hva
-- som skjedde og nok kontekst (show, ordre, sesjon) til å finne igjen
-- saken. Superadmin ser dem under /superadmin/errors og kvitterer dem ut.
-- Raden er et spor, ikke en kø: ingenting i appen leser den tilbake.
-- ============================================================

create table if not exists app_errors (
  id          uuid primary key default gen_random_uuid(),

  -- Hvor det skjedde: checkout, free_tickets, ticket_email, stripe_webhook,
  -- cron. Fri tekst, så et nytt område ikke krever en migrasjon.
  scope       text not null,
  message     text not null,
  stack       text,
  -- Det som trengs for å finne saken igjen: show_id, order_id, session osv.
  context     jsonb not null default '{}'::jsonb,

  -- Satt når noen i superadmin har sett feilen. Null = venter.
  resolved_at timestamptz,
  resolved_by uuid references profiles(id) on delete set null,

  created_at  timestamptz not null default now()
);

comment on table app_errors is
  'Feil appen selv meldte fra om (lib/error-log.ts). Et spor for superadmin, '
  'ikke en kø: ingenting leser radene tilbake. Kvitteres ut med resolved_at.';

-- Menyen teller de uleste; lista viser de nyeste først.
create index if not exists idx_app_errors_unresolved
  on app_errors (created_at desc) where resolved_at is null;
create index if not exists idx_app_errors_created
  on app_errors (created_at desc);

alter table app_errors enable row level security;

-- Skrives med service-nøkkelen (omgår RLS). Superadmin leser og kvitterer.
drop policy if exists "Superadmin manage app errors" on app_errors;
create policy "Superadmin manage app errors"
  on app_errors for all
  using (is_superadmin()) with check (is_superadmin());
