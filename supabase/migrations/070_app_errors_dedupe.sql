-- ============================================================
-- Migration 070: Samme feil én gang
--
-- Stripe prøver en feilet webhook på nytt i dager, og et show med ødelagt
-- Stripe-oppsett får ett kjøpsforsøk per publikummer som trykker. Hvert
-- forsøk ble en egen rad i app_errors, og superadmin måtte kvittere ut
-- hundre like. Nå får hver feil et fingeravtrykk (område + melding +
-- kontekst), og en feil som alt venter med samme avtrykk telles opp i
-- stedet for å skrives på nytt. Er den kvittert ut, starter tellingen på
-- en ny rad — da er det en ny forekomst noen skal se.
-- ============================================================

alter table app_errors
  add column if not exists fingerprint  text,
  add column if not exists occurrences  integer     not null default 1,
  add column if not exists last_seen_at timestamptz not null default now();

comment on column app_errors.fingerprint is
  'sha256 av område, melding og kontekst. Like feil som venter samles på én rad.';
comment on column app_errors.occurrences is
  'Hvor mange ganger feilen har skjedd siden raden ble opprettet.';
comment on column app_errors.last_seen_at is
  'Siste forekomst. created_at er den første.';

update app_errors set fingerprint = md5(scope || '|' || message) where fingerprint is null;

create index if not exists idx_app_errors_open_fingerprint
  on app_errors (fingerprint) where resolved_at is null;

-- Teller opp den nyeste ventende raden med samme avtrykk, ellers ny rad.
-- Én funksjon, så opp­tellingen er atomisk og ikke les-så-skriv fra appen.
create or replace function record_app_error(
  p_scope text,
  p_message text,
  p_stack text,
  p_context jsonb,
  p_fingerprint text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update app_errors
  set occurrences = occurrences + 1,
      last_seen_at = now(),
      context = coalesce(p_context, context),
      stack = coalesce(p_stack, stack)
  where id = (
    select id from app_errors
    where fingerprint = p_fingerprint and resolved_at is null
    order by last_seen_at desc
    limit 1
  )
  returning id into v_id;

  if v_id is null then
    insert into app_errors (scope, message, stack, context, fingerprint)
    values (p_scope, p_message, p_stack, coalesce(p_context, '{}'::jsonb), p_fingerprint)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function record_app_error(text, text, text, jsonb, text) from public;
revoke all on function record_app_error(text, text, text, jsonb, text) from anon;
revoke all on function record_app_error(text, text, text, jsonb, text) from authenticated;
grant execute on function record_app_error(text, text, text, jsonb, text) to service_role;
