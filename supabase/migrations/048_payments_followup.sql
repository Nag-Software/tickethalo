-- ============================================================
-- Migration 048: Oppfølging av 047 (betalinger)
--
-- 047 ble lagt på databasen før gjennomgangen av den var ferdig, og filen
-- ble utvidet etterpå. Migreringsverktøyet husker filnavn, ikke innhold, så
-- utvidelsene når aldri en database som allerede har 047. Denne migrasjonen
-- tar dem med. Alt er idempotent: på en ny database, der 047 allerede har
-- alt, endrer den ingenting.
--
--  * Disputter: status, tidspunkt og klubbens netto tap per ordre.
--  * Refusjoner: status fra Stripe, forsøk og siste feil. En refusjon som
--    ikke er fullført blokkerer sletting av showet.
--  * complete_checkout_order: stengt salg gir `sales_closed` (ingen
--    billetter, automatisk refusjon); gebyrstatus følger betalingen.
--  * club_releasable_amount: realiserte tap (disputter, refusjoner uten
--    tilbakeført provisjon) trekkes fra; ukjent provisjon holdes tilbake.
--  * Plattformspeilet skiller test og live (`livemode`), og månedsvisningen
--    holder bevegelser til og fra egen bank utenfor resultatet.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- orders — nye kolonner
-- ─────────────────────────────────────────────────────────────
alter table orders
  add column if not exists dispute_status          text,
  add column if not exists disputed_at             timestamptz,
  add column if not exists dispute_net_amount      integer not null default 0,
  add column if not exists refund_status           text,
  add column if not exists refund_attempts         integer not null default 0,
  add column if not exists last_refund_attempt_at  timestamptz,
  add column if not exists last_refund_error       text;

alter table orders drop constraint if exists orders_cancellation_reason_check;
alter table orders
  add constraint orders_cancellation_reason_check
    check (cancellation_reason is null or cancellation_reason in ('sold_out', 'invalid_show', 'sales_closed'));

comment on column orders.cancellation_reason is
  'Hvorfor en betalt sesjon ikke ga billetter: utsolgt, showet ikke lenger i '
  'salg, eller salget stengt av bookeren før betalingen ble fullført. Slike '
  'ordrer er betalt hos Stripe og står i refusjonskøen til `refunded_at` er satt.';
comment on column orders.dispute_status is
  'Stripe-disputtens status (needs_response, under_review, won, lost …). En '
  'åpen disputt kan ikke refunderes. En tapt disputt som dekker hele '
  'betalingen lukker ordren som refundert; tapet står i dispute_net_amount.';
comment on column orders.dispute_net_amount is
  'Det klubben netto har tapt på disputter for betalingen: trukne beløp og '
  'disputtgebyr minus det Stripe har ført tilbake (−Σ net av disputtens '
  'balance transactions). Trekkes fra det som kan utbetales.';
comment on column orders.refund_status is
  'Status på siste refusjon fra Stripe (pending, requires_action, succeeded, '
  'failed, canceled). En refusjon som ikke er fullført blokkerer sletting.';
comment on column orders.refund_attempts is
  'Antall refusjonsforsøk som har feilet eller blitt reversert av Stripe. '
  'Brukes til idempotency key per forsøk og til å slippe køen videre.';

-- ─────────────────────────────────────────────────────────────
-- Tilbakefylling
-- ─────────────────────────────────────────────────────────────
-- Stripe tar gebyr for alle betalinger på klubbkontoene, også når
-- charge-ID-en mangler. Bare `not_applicable` flyttes; bokførte står.
update orders
set stripe_fee_status = 'pending'
where stripe_fee_status = 'not_applicable'
  and stripe_payment_intent_id is not null
  and stripe_connected_account_id is not null;

-- Refusjonene før 047 gikk gjennom refundOrder med `refund_application_fee`,
-- så provisjonen ble ført tilbake til klubben. Uten dette ville
-- club_releasable_amount regnet provisjonen som et tap på hver gamle refusjon.
update orders
set application_fee_refunded_amount = platform_fee_amount
where status = 'refunded'
  and application_fee_refunded_amount = 0
  and stripe_connected_account_id is not null
  and coalesce(platform_fee_amount, 0) > 0;

-- Ordrer fra før 032 har ikke club_id. Ordrelisten og tilgangssjekken går på
-- club_id, så de hentes fra showet.
update orders o
set club_id = s.club_id
from shows s
where o.show_id = s.id
  and o.club_id is null
  and s.club_id is not null;

-- Betalte sesjoner uten billetter fra før 047 har ingen årsak. De er ugyldige
-- show i praksis, og årsaken holder dem utenfor avregningen.
update orders
set cancellation_reason = 'invalid_show'
where status = 'cancelled'
  and stripe_payment_intent_id is not null
  and cancellation_reason is null;

-- Samme filter og rekkefølge som processRefundQueue: aldri forsøkt først,
-- så eldst. Ordrer uten klubbkonto kan ikke refunderes av køen.
drop index if exists idx_orders_refund_queue;
create index idx_orders_refund_queue
  on orders(last_refund_attempt_at nulls first, created_at)
  where status = 'cancelled'
    and stripe_payment_intent_id is not null
    and stripe_connected_account_id is not null
    and refunded_at is null;

-- ─────────────────────────────────────────────────────────────
-- Funksjoner
-- ─────────────────────────────────────────────────────────────
create or replace function club_releasable_amount(p_club_id uuid)
returns table (
  earned_amount   bigint,
  committed_amount bigint,
  releasable_amount bigint,
  cutoff_date     date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cutoff date;
  v_earned bigint;
  v_committed bigint;
begin
  select (now() at time zone 'Europe/Oslo')::date - c.payout_hold_days
    into v_cutoff
  from clubs c
  where c.id = p_club_id;

  if v_cutoff is null then
    return query select 0::bigint, 0::bigint, 0::bigint, null::date;
    return;
  end if;

  -- Klubbens faktiske andel av en ordre etter refusjoner: det klubben fikk
  -- (brutto − provisjon), minus det som gikk tilbake til kunden, pluss
  -- provisjonen Tickethalo førte tilbake. Uten tilbakeført provisjon (en
  -- refusjon i Stripe-dashbordet) blir andelen negativ — klubben har da
  -- betalt provisjonen på et salg som ikke ble noe av.
  --
  -- Betalte ordrer på avholdte show frigis. Alt annet (framtidige show,
  -- refunderte og kansellerte ordrer) teller bare med sine realiserte tap,
  -- slik at et tap aldri dekkes av penger som holdes for andre show.
  select coalesce(sum(
           case
             when o.status = 'paid'
                  and s.id is not null
                  and s.date <= v_cutoff
                  and s.status <> 'cancelled'
                  and s.deleted_at is null
               then r.realized
             else least(r.realized, 0)
           end), 0)
    into v_earned
  from orders o
  left join shows s on s.id = o.show_id
  cross join lateral (
    -- Uten kjent provisjon (betalingsdetaljene ikke reparert ennå) er
    -- andelen ukjent og holdes tilbake, i stedet for å frigi hele beløpet.
    select coalesce(o.club_net_amount, o.amount_total - o.platform_fee_amount)
           - o.refunded_amount
           + o.application_fee_refunded_amount
           - o.dispute_net_amount as realized
  ) r
  where o.club_id = p_club_id
    and o.stripe_connected_account_id is not null
    and (o.status = 'paid' or o.refunded_amount > 0 or o.dispute_net_amount <> 0);

  select coalesce(sum(p.amount), 0)
    into v_committed
  from club_payouts p
  where p.club_id = p_club_id
    and p.status in ('creating', 'pending', 'in_transit', 'paid');

  return query select v_earned, v_committed, greatest(v_earned - v_committed, 0), v_cutoff;
end;
$$;

comment on function club_releasable_amount is
  'Hvor mye som kan utbetales til klubben nå, fra hovedboken. Brukes av både '
  'økonomisiden og reserve_club_payout, slik at de aldri kan være uenige.';

drop function if exists show_sales_summary(uuid);
create or replace function show_sales_summary(p_show_id uuid)
returns table (
  paid_orders            integer,
  paid_amount            bigint,
  valid_tickets          integer,
  used_tickets           integer,
  refunded_orders        integer,
  awaiting_refund_orders integer,
  awaiting_refund_amount bigint,
  total_orders           integer,
  fee_invoices           integer,
  open_dispute_orders    integer,
  pending_refund_orders  integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int from orders o where o.show_id = p_show_id and o.status = 'paid'),
    (select coalesce(sum(o.amount_total - o.refunded_amount), 0)::bigint
       from orders o where o.show_id = p_show_id and o.status = 'paid'),
    (select count(*)::int from tickets t where t.show_id = p_show_id and t.status = 'valid'),
    (select count(*)::int from tickets t where t.show_id = p_show_id and t.status = 'used'),
    (select count(*)::int from orders o where o.show_id = p_show_id and o.status = 'refunded'),
    (select count(*)::int from orders o
       where o.show_id = p_show_id and o.status = 'cancelled'
         and o.stripe_payment_intent_id is not null and o.refunded_at is null),
    (select coalesce(sum(o.amount_total), 0)::bigint from orders o
       where o.show_id = p_show_id and o.status = 'cancelled'
         and o.stripe_payment_intent_id is not null and o.refunded_at is null),
    (select count(*)::int from orders o where o.show_id = p_show_id),
    (select count(*)::int from artist_fee_invoices i where i.show_id = p_show_id),
    (select count(*)::int from orders o
       where o.show_id = p_show_id
         and o.dispute_status is not null
         and o.dispute_status not in ('won', 'lost', 'warning_closed', 'prevented')),
    (select count(*)::int from orders o
       where o.show_id = p_show_id
         and o.refund_status in ('pending', 'requires_action'));
$$;

create or replace function delete_show(p_show_id uuid, p_actor_id uuid default null)
returns table (
  result                 text,
  paid_orders            integer,
  valid_tickets          integer,
  used_tickets           integer,
  awaiting_refund_orders integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_show shows%rowtype;
  v_summary record;
begin
  select * into v_show
  from shows
  where id = p_show_id
  for update;

  if not found or v_show.deleted_at is not null then
    return query select 'not_found'::text, 0, 0, 0, 0;
    return;
  end if;

  select * into v_summary from show_sales_summary(p_show_id);

  if v_summary.paid_orders > 0
     or v_summary.valid_tickets > 0
     or v_summary.used_tickets > 0
     or v_summary.awaiting_refund_orders > 0
     or v_summary.open_dispute_orders > 0
     or v_summary.pending_refund_orders > 0 then
    return query select 'blocked'::text, v_summary.paid_orders, v_summary.valid_tickets,
      v_summary.used_tickets, v_summary.awaiting_refund_orders;
    return;
  end if;

  if v_summary.total_orders > 0 or v_summary.fee_invoices > 0 then
    update shows
    set deleted_at = now(),
        deleted_by = p_actor_id,
        status = 'cancelled',
        ticket_sales_closed_at = coalesce(ticket_sales_closed_at, now()),
        ticket_sales_closed_by = coalesce(ticket_sales_closed_by, p_actor_id)
    where id = p_show_id;

    -- Et arkivert show skal ikke kunne bookes videre.
    update booking_offers set status = 'cancelled'
    where show_id = p_show_id and status = 'sent';
    update confirmed_spots set status = 'cancelled'
    where show_id = p_show_id and status = 'confirmed';

    return query select 'archived'::text, 0, 0, 0, 0;
    return;
  end if;

  delete from shows where id = p_show_id;
  return query select 'deleted'::text, 0, 0, 0, 0;
end;
$$;

create or replace function complete_checkout_order(
  p_show_id uuid,
  p_session_id text,
  p_payment_intent_id text default null,
  p_stripe_customer_id text default null,
  p_amount_total integer default 0,
  p_currency text default 'NOK',
  p_buyer_email text default null,
  p_buyer_name text default null,
  p_club_id uuid default null,
  p_connected_account_id text default null,
  p_charge_id text default null,
  p_application_fee_id text default null,
  p_platform_fee_amount integer default null,
  p_payment_method_type text default null,
  p_quantity integer default 1,
  p_ticket_names text[] default null
)
returns table (
  result text,
  order_id uuid,
  ticket_code text,
  ticket_codes text[],
  duplicate boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_show shows%rowtype;
  v_customer_id uuid;
  v_order_id uuid;
  v_ticket_code text;
  v_ticket_codes text[];
  v_sold_count integer;
  v_club_id uuid;
  v_show_found boolean;
  v_quantity integer;
  v_index integer;
  v_holder text;
  v_fee_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_session_id, 0));

  v_quantity := greatest(1, coalesce(p_quantity, 1));
  -- Stripe tar gebyr for alle betalinger på klubbkontoene, også når
  -- betalingsdetaljene ikke kunne leses ved oppgjøret. Charge-ID-en fylles
  -- da inn i etterkant (repairMissingChargeFacts).
  v_fee_status := case
    when p_payment_intent_id is null or p_connected_account_id is null then 'not_applicable'
    else 'pending'
  end;

  -- Samme sesjon to ganger er webhooken og suksesssiden som kappes om
  -- å bokføre den. Da skal billettene som allerede finnes returneres.
  select o.id into v_order_id
  from orders o
  where o.stripe_checkout_session_id = p_session_id
  limit 1;

  if v_order_id is not null then
    select array_agg(t.ticket_code order by t.created_at), min(t.ticket_code)
      into v_ticket_codes, v_ticket_code
    from tickets t
    where t.order_id = v_order_id;

    return query select 'duplicate'::text, v_order_id, v_ticket_code, v_ticket_codes, true;
    return;
  end if;

  select * into v_show
  from shows
  where id = p_show_id
  for update;

  v_show_found := found;

  -- Klubben kommer fra showet når den ikke er oppgitt. Ordren skal peke på
  -- klubben selv når showet er ugyldig — ellers mister vi sporet til hvem
  -- pengene tilhører for nettopp de radene som må refunderes.
  v_club_id := coalesce(p_club_id, v_show.club_id);

  if not v_show_found
     or v_show.deleted_at is not null
     or v_show.status <> 'published'
     or v_show.date < (now() at time zone 'Europe/Oslo')::date then
    insert into orders (
      show_id, club_id, stripe_checkout_session_id, stripe_payment_intent_id,
      stripe_customer_id, stripe_connected_account_id, stripe_charge_id,
      stripe_application_fee_id, amount_total, gross_amount, platform_fee_amount,
      payment_method_type, currency, status, cancellation_reason, stripe_fee_status,
      buyer_email, buyer_name
    ) values (
      case when v_show_found then p_show_id else null end, v_club_id, p_session_id,
      p_payment_intent_id, p_stripe_customer_id, p_connected_account_id, p_charge_id,
      p_application_fee_id, p_amount_total, p_amount_total, p_platform_fee_amount,
      p_payment_method_type, upper(coalesce(p_currency, 'NOK')), 'cancelled', 'invalid_show',
      v_fee_status, p_buyer_email, p_buyer_name
    )
    returning id into v_order_id;

    return query select 'invalid_show'::text, v_order_id, null::text, null::text[], false;
    return;
  end if;

  select count(*) into v_sold_count
  from tickets
  where show_id = p_show_id
    and status in ('valid', 'used');

  -- Hele bestillingen må få plass. Delvis oppfylling ville sendt kunden
  -- to billetter av fire betalte, uten at noe sa fra.
  -- Bookeren har stengt salget. Åpne checkouts utløper når salget stenges,
  -- men en betaling som var underveis kan likevel fullføres hos Stripe.
  -- Løftet til bookeren er at ingen billetter utstedes etter stengning, så
  -- betalingen lagres uten billetter og refunderes automatisk.
  if v_show.ticket_sales_closed_at is not null then
    insert into orders (
      show_id, club_id, stripe_checkout_session_id, stripe_payment_intent_id,
      stripe_customer_id, stripe_connected_account_id, stripe_charge_id,
      stripe_application_fee_id, amount_total, gross_amount, platform_fee_amount,
      payment_method_type, currency, status, cancellation_reason, stripe_fee_status,
      buyer_email, buyer_name
    ) values (
      p_show_id, v_club_id, p_session_id, p_payment_intent_id,
      p_stripe_customer_id, p_connected_account_id, p_charge_id,
      p_application_fee_id, p_amount_total, p_amount_total, p_platform_fee_amount,
      p_payment_method_type, upper(coalesce(p_currency, 'NOK')), 'cancelled', 'sales_closed',
      v_fee_status, p_buyer_email, p_buyer_name
    )
    returning id into v_order_id;

    return query select 'sales_closed'::text, v_order_id, null::text, null::text[], false;
    return;
  end if;

  if v_show.capacity is not null and v_sold_count + v_quantity > v_show.capacity then
    insert into orders (
      show_id, club_id, stripe_checkout_session_id, stripe_payment_intent_id,
      stripe_customer_id, stripe_connected_account_id, stripe_charge_id,
      stripe_application_fee_id, amount_total, gross_amount, platform_fee_amount,
      payment_method_type, currency, status, cancellation_reason, stripe_fee_status,
      buyer_email, buyer_name
    ) values (
      p_show_id, v_club_id, p_session_id, p_payment_intent_id,
      p_stripe_customer_id, p_connected_account_id, p_charge_id,
      p_application_fee_id, p_amount_total, p_amount_total, p_platform_fee_amount,
      p_payment_method_type, upper(coalesce(p_currency, 'NOK')), 'cancelled', 'sold_out',
      v_fee_status, p_buyer_email, p_buyer_name
    )
    returning id into v_order_id;

    return query select 'sold_out'::text, v_order_id, null::text, null::text[], false;
    return;
  end if;

  if p_buyer_email is not null and length(trim(p_buyer_email)) > 0 then
    select id into v_customer_id
    from customers
    where lower(email) = lower(p_buyer_email)
    order by created_at asc
    limit 1;

    if v_customer_id is null then
      insert into customers (email, name, stripe_customer_id)
      values (p_buyer_email, nullif(p_buyer_name, ''), p_stripe_customer_id)
      returning id into v_customer_id;
    end if;
  end if;

  insert into orders (
    show_id, club_id, customer_id, stripe_checkout_session_id,
    stripe_payment_intent_id, stripe_customer_id, stripe_connected_account_id,
    stripe_charge_id, stripe_application_fee_id, amount_total, gross_amount,
    platform_fee_amount, club_net_amount, stripe_fee_status, payment_method_type,
    currency, status, buyer_email, buyer_name
  ) values (
    p_show_id, v_club_id, v_customer_id, p_session_id,
    p_payment_intent_id, p_stripe_customer_id, p_connected_account_id,
    p_charge_id, p_application_fee_id, p_amount_total, p_amount_total,
    p_platform_fee_amount,
    case when p_platform_fee_amount is null then null
         else p_amount_total - p_platform_fee_amount end,
    v_fee_status,
    p_payment_method_type,
    upper(coalesce(p_currency, 'NOK')), 'paid', p_buyer_email, p_buyer_name
  )
  returning id into v_order_id;

  v_ticket_codes := array[]::text[];

  for v_index in 1..v_quantity loop
    -- Mangler navnet, står kjøperens eget. En navnløs billett i døra
    -- hjelper ingen.
    v_holder := nullif(trim(coalesce(p_ticket_names[v_index], '')), '');

    insert into tickets (show_id, order_id, customer_id, status, holder_name)
    values (p_show_id, v_order_id, v_customer_id, 'valid',
            coalesce(v_holder, nullif(trim(coalesce(p_buyer_name, '')), '')))
    returning tickets.ticket_code into v_ticket_code;

    v_ticket_codes := v_ticket_codes || v_ticket_code;
  end loop;

  return query select 'created'::text, v_order_id, v_ticket_codes[1], v_ticket_codes, false;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Plattformspeilet — test og live holdes adskilt
--
-- Tabellene er tomme på databasene som har 047, og det er testnøkler som
-- har skrevet til dem. Eksisterende rader (om noen) regnes som test.
-- ─────────────────────────────────────────────────────────────
alter table platform_balance_transactions add column if not exists livemode boolean not null default false;
alter table platform_balance_transactions alter column livemode drop default;
alter table stripe_fee_entries add column if not exists livemode boolean not null default false;
alter table stripe_fee_entries alter column livemode drop default;
alter table stripe_fee_report_runs add column if not exists livemode boolean not null default false;
alter table stripe_fee_report_runs alter column livemode drop default;

drop index if exists idx_platform_bt_created;
create index idx_platform_bt_created on platform_balance_transactions(livemode, created_at_stripe desc);

-- Månedlig resultat for Tickethalo per valuta og modus, rett fra Stripe-saldoen.
--
-- Bevegelser (utbetalinger til egen bank, reverserte utbetalinger, top-ups og
-- saldoreservasjoner) flytter penger, men er ikke resultat. Marginen summerer
-- `net` (amount − fee), slik Stripe-saldoen gjør.
drop view if exists platform_ledger_monthly;
create view platform_ledger_monthly
  with (security_invoker = true)
as
with classified as (
  select
    bt.*,
    (bt.type in ('payout', 'payout_cancel', 'payout_failure', 'payout_minimum_balance_hold',
                 'payout_minimum_balance_release', 'topup', 'topup_reversal')
     or bt.reporting_category in ('payout', 'payout_reversal', 'topup', 'topup_reversal')) as is_movement
  from platform_balance_transactions bt
)
select
  (date_trunc('month', c.created_at_stripe at time zone 'Europe/Oslo'))::date as month,
  c.livemode,
  c.currency,
  coalesce(sum(c.amount) filter (where c.type = 'application_fee'), 0)::bigint          as commission_amount,
  coalesce(-sum(c.amount) filter (where c.type = 'application_fee_refund'), 0)::bigint  as commission_refunded_amount,
  (coalesce(-sum(c.amount) filter (where c.reporting_category = 'fee'), 0)
   + coalesce(sum(c.fee) filter (where not c.is_movement), 0))::bigint                   as stripe_fee_amount,
  coalesce(sum(c.amount) filter (
    where not c.is_movement
      and c.type not in ('application_fee', 'application_fee_refund')
      and c.reporting_category <> 'fee'), 0)::bigint                                     as other_amount,
  coalesce(sum(c.net) filter (where not c.is_movement), 0)::bigint                      as margin_amount
from classified c
group by 1, 2, 3;

comment on view platform_ledger_monthly is
  'Tickethalos resultat per måned: provisjon − tilbakeført provisjon − '
  'Stripe-gebyrer ± øvrige poster (disputes o.l.) = margin. Bevegelser til og '
  'fra egen bank holdes utenfor. livemode skiller testdata fra ekte penger.';

-- ─────────────────────────────────────────────────────────────
-- Rettigheter — show_sales_summary er laget på nytt, så alle settes igjen
-- ─────────────────────────────────────────────────────────────
-- `security definer`-funksjoner kan ellers kalles av hvem som helst med den
-- offentlige nøkkelen via PostgREST. complete_checkout_order ville da latt en
-- anonym bruker lage betalte ordrer og gyldige billetter uten betaling.
do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'complete_checkout_order(uuid, text, text, text, integer, text, text, text, uuid, text, text, text, integer, text, integer, text[])',
    'club_releasable_amount(uuid)',
    'reserve_club_payout(uuid, integer, text, text)',
    'show_sales_summary(uuid)',
    'delete_show(uuid, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', v_function);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', v_function);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', v_function);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', v_function);
    end if;
  end loop;
end;
$$;
