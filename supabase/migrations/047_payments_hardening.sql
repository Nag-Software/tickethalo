-- ============================================================
-- Migration 047: Betalingsløsningen gjøres produksjonsmoden
--
-- Fem ting som hører sammen, fordi de alle handler om at
-- økonomiske rader aldri skal forsvinne eller bli feil:
--
--  1. Show med salg kan ikke slettes. Et show kan bare slettes
--     når alt er refundert, og har det salgshistorikk blir det
--     arkivert i stedet — ordrer og billetter står.
--  2. Billettsalg kan stenges uten å avpublisere showet.
--  3. Utbetalinger følger Stripes egen status (pending →
--     in_transit → paid/failed) i stedet for å merkes betalt
--     når forespørselen er godtatt.
--  4. Beløpet som frigis regnes og reserveres atomisk, slik at
--     to samtidige kjøringer ikke kan utbetale det samme.
--  5. Stripe-gebyret bokføres der Stripe faktisk trekker det:
--     på plattformkontoen. Klubbene er opprettet med
--     `fees_collector = application`, så gebyret har aldri
--     stått på klubbens transaksjon. «True-up»-modellen fra
--     032 bygget på motsatt antakelse og fjernes.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. shows — stengt salg og arkivering
-- ─────────────────────────────────────────────────────────────
alter table shows
  add column if not exists ticket_sales_closed_at timestamptz,
  add column if not exists ticket_sales_closed_by uuid references profiles(id) on delete set null,
  add column if not exists deleted_at             timestamptz,
  add column if not exists deleted_by             uuid references profiles(id) on delete set null;

comment on column shows.ticket_sales_closed_at is
  'Satt = bookeren har stengt billettsalget. Showet er fortsatt synlig, '
  'men ingen nye betalinger kan startes. Null = salget følger vanlige regler '
  '(publisert, innenfor salgsvinduet på 90 dager).';
comment on column shows.deleted_at is
  'Satt = showet er slettet av bookeren, men hadde salgshistorikk og er '
  'derfor arkivert i stedet for fjernet. Ordrer, billetter og fakturagrunnlag '
  'står. Se delete_show().';

create index if not exists idx_shows_not_deleted on shows(club_id, date) where deleted_at is null;

-- ─────────────────────────────────────────────────────────────
-- Økonomiske rader skal aldri forsvinne med et show.
--
-- 001 lot `tickets.show_id` kaskadere og `orders.show_id` bli null.
-- Det slettet billetter og gjorde ordrer foreldreløse, slik at
-- utbetalingen aldri fant pengene igjen. Nå nekter databasen.
-- Navnene på fremmednøklene er ikke garantert, så de slås opp.
-- ─────────────────────────────────────────────────────────────
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select con.conname, rel.relname as table_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_class ref on ref.oid = con.confrelid
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
    where con.contype = 'f'
      and nsp.nspname = 'public'
      and ref.relname = 'shows'
      and rel.relname in ('orders', 'tickets', 'artist_fee_invoices')
      and att.attname = 'show_id'
  loop
    execute format('alter table %I drop constraint %I', v_constraint.table_name, v_constraint.conname);
  end loop;
end;
$$;

alter table orders
  add constraint orders_show_id_fkey
    foreign key (show_id) references shows(id) on delete restrict;
alter table tickets
  add constraint tickets_show_id_fkey
    foreign key (show_id) references shows(id) on delete restrict;
alter table artist_fee_invoices
  add constraint artist_fee_invoices_show_id_fkey
    foreign key (show_id) references shows(id) on delete restrict;

-- ─────────────────────────────────────────────────────────────
-- 2. orders — refusjoner, refusjonskø og gebyrbokføring
-- ─────────────────────────────────────────────────────────────
alter table orders
  add column if not exists refunded_amount                 integer not null default 0,
  add column if not exists application_fee_refunded_amount integer not null default 0,
  add column if not exists cancellation_reason             text,
  add column if not exists stripe_fee_tax_amount           integer,
  add column if not exists stripe_fee_status               text not null default 'pending',
  add column if not exists stripe_fee_reconciled_at        timestamptz,
  add column if not exists dispute_status                  text,
  add column if not exists disputed_at                     timestamptz,
  add column if not exists refund_attempts                 integer not null default 0,
  add column if not exists last_refund_attempt_at          timestamptz,
  add column if not exists last_refund_error               text;

alter table orders
  drop constraint if exists orders_cancellation_reason_check;
alter table orders
  add constraint orders_cancellation_reason_check
    check (cancellation_reason is null or cancellation_reason in ('sold_out', 'invalid_show', 'sales_closed'));

alter table orders
  drop constraint if exists orders_stripe_fee_status_check;
alter table orders
  add constraint orders_stripe_fee_status_check
    check (stripe_fee_status in ('pending', 'reconciled', 'not_applicable'));

comment on column orders.refunded_amount is
  'Sum refundert til kunden, fra charge.amount_refunded. Ordren står som '
  '`refunded` først når hele beløpet er refundert — en delrefusjon i Stripe '
  'endrer ikke status eller billetter.';
comment on column orders.application_fee_refunded_amount is
  'Den delen av formidlingsprovisjonen som er ført tilbake til klubben.';
comment on column orders.cancellation_reason is
  'Hvorfor en betalt sesjon ikke ga billetter: utsolgt, showet ikke lenger i '
  'salg, eller salget stengt av bookeren før betalingen ble fullført. Slike '
  'ordrer er betalt hos Stripe og står i refusjonskøen til `refunded_at` er satt.';
comment on column orders.dispute_status is
  'Stripe-disputtens status (needs_response, under_review, won, lost …). En '
  'åpen disputt kan ikke refunderes; en tapt disputt har gitt kunden pengene '
  'tilbake og regnes som refundert.';
comment on column orders.refund_attempts is
  'Antall refusjonsforsøk som har feilet eller blitt reversert av Stripe. '
  'Brukes til idempotency key per forsøk og til å slippe køen videre.';
comment on column orders.stripe_fee_amount is
  'Stripes behandlingsgebyr for betalingen, inkl. mva. Belastes Tickethalos '
  'plattformkonto (fees_collector = application), ikke klubben. Hentes fra '
  'Stripes gebyrrapport (incurred_by = charge). Påvirker ikke club_net_amount.';
comment on column orders.stripe_fee_tax_amount is
  'Mva-delen av stripe_fee_amount, slik Stripe rapporterer den.';
comment on column orders.stripe_fee_status is
  'pending = venter på Stripes gebyrrapport (tilgjengelig ~96 t etter betaling), '
  'reconciled = gebyret er bokført fra rapporten, not_applicable = ingen '
  'Stripe-betaling på plattformen (f.eks. eldre testordrer).';
comment on column orders.club_net_amount is
  'Klubbens andel: gross_amount − platform_fee_amount. Stripe-gebyret trekkes '
  'ikke herfra — det betales av Tickethalo. Grunnlaget for utbetaling og '
  'artisthonorar.';

-- Gebyr-oppgjøret fra 032 flyttet penger basert på en antakelse som ikke
-- stemmer for kontoene våre. Feltene har ingen gyldig betydning lenger.
drop index if exists idx_orders_fee_trueup;
alter table orders drop constraint if exists orders_fee_trueup_status_check;
alter table orders
  drop column if exists fee_trueup_amount,
  drop column if exists fee_trueup_status;

update orders
set stripe_fee_status = case
  when stripe_payment_intent_id is null or stripe_connected_account_id is null then 'not_applicable'
  else 'pending'
end;

-- Eldre ordrer uten Stripe-betaling har ikke noe gebyr å vente på.
-- Refunderte ordrer har refundert hele beløpet.
update orders
set refunded_amount = coalesce(amount_total, 0)
where status = 'refunded' and refunded_amount = 0;

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

create index if not exists idx_orders_refund_queue
  on orders(created_at)
  where status = 'cancelled' and stripe_payment_intent_id is not null and refunded_at is null;
create index if not exists idx_orders_fee_pending
  on orders(created_at)
  where stripe_fee_status = 'pending';
create index if not exists idx_orders_show_status on orders(show_id, status);

-- ─────────────────────────────────────────────────────────────
-- 3. clubs — utbetalingsplanen er en del av klarheten
-- ─────────────────────────────────────────────────────────────
alter table clubs
  add column if not exists payout_schedule_interval   text,
  add column if not exists payout_schedule_checked_at timestamptz;

comment on column clubs.payout_schedule_interval is
  'Utbetalingsplanen slik Stripe Balance Settings rapporterer den. Må være '
  '`manual` før klubben kan selge — ellers kan Stripe utbetale billettpenger '
  'før showet er avholdt.';

-- Stripe-gebyret kan ikke velges per klubb: betaleren settes én gang når
-- kontoen opprettes, og alle klubbkontoer har Tickethalo som betaler.
alter table clubs drop column if exists absorb_stripe_fee;

-- ─────────────────────────────────────────────────────────────
-- 4. club_payouts — Stripes statusmaskin
-- ─────────────────────────────────────────────────────────────
alter table club_payouts
  add column if not exists stripe_account_id text,
  add column if not exists origin            text not null default 'tickethalo',
  add column if not exists arrival_date      date,
  add column if not exists failure_code      text,
  add column if not exists failed_at         timestamptz,
  add column if not exists cancelled_at      timestamptz,
  add column if not exists status_synced_at  timestamptz;

alter table club_payouts drop constraint if exists club_payouts_status_check;
alter table club_payouts
  add constraint club_payouts_status_check
    check (status in ('creating', 'pending', 'in_transit', 'paid', 'failed', 'cancelled'));

alter table club_payouts drop constraint if exists club_payouts_origin_check;
alter table club_payouts
  add constraint club_payouts_origin_check
    check (origin in ('tickethalo', 'stripe'));

comment on column club_payouts.status is
  'creating = reservert i databasen, forespørselen til Stripe er ikke bekreftet. '
  'pending/in_transit/paid/failed/cancelled speiler Stripe-utbetalingen og '
  'oppdateres av payout.*-webhooks. En utbetaling kan gå fra paid til failed.';
comment on column club_payouts.origin is
  'tickethalo = opprettet av utbetalingsjobben, stripe = oppdaget via webhook '
  '(f.eks. opprettet i Stripe-dashbordet). Begge teller mot det som er utbetalt.';

-- Maks én ubekreftet utbetaling per klubb. En kjøring som krasjer mellom
-- reservasjon og Stripe-kall blir stående her og gjenopptas med samme
-- idempotency key, i stedet for at en ny rad gir en ny utbetaling.
create unique index if not exists idx_club_payouts_one_creating
  on club_payouts(club_id) where status = 'creating';
create index if not exists idx_club_payouts_open
  on club_payouts(status, created_at) where status in ('creating', 'pending', 'in_transit', 'paid');

-- ─────────────────────────────────────────────────────────────
-- club_releasable_amount — én definisjon av «klar for utbetaling»
--
-- Betalte ordrer på avholdte show (showdato + klubbens hold-dager,
-- norsk dato), minus utbetalinger som ikke har feilet. Delrefusjoner
-- trekkes fra klubbens andel. Arkiverte/kansellerte show frigis ikke.
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
    select coalesce(o.club_net_amount, o.amount_total - coalesce(o.platform_fee_amount, 0), 0)
           - o.refunded_amount
           + o.application_fee_refunded_amount as realized
  ) r
  where o.club_id = p_club_id
    and o.stripe_connected_account_id is not null
    and (o.status = 'paid' or o.refunded_amount > 0);

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

-- ─────────────────────────────────────────────────────────────
-- reserve_club_payout — atomisk reservasjon
--
-- Låser klubben, finner en eksisterende ubekreftet reservasjon
-- (gjenopptak) eller regner beløpet og skriver en ny rad i samme
-- transaksjon. To samtidige kjøringer serialiseres på låsen; den
-- andre ser den første sin rad og får den tilbake i stedet for å
-- lage en ny. Rad-ID-en er idempotency key mot Stripe.
-- ─────────────────────────────────────────────────────────────
create or replace function reserve_club_payout(
  p_club_id uuid,
  p_available_amount integer,
  p_currency text,
  p_stripe_account_id text
)
returns table (
  payout_id uuid,
  amount integer,
  resumed boolean,
  created_at timestamptz,
  releasable_amount bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing club_payouts%rowtype;
  v_releasable bigint;
  v_cutoff date;
  v_amount integer;
  v_row club_payouts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('club_payout:' || p_club_id::text, 0));

  select * into v_existing
  from club_payouts p
  where p.club_id = p_club_id
    and p.status = 'creating'
  limit 1;

  if found then
    return query select v_existing.id, v_existing.amount, true, v_existing.created_at, null::bigint;
    return;
  end if;

  select r.releasable_amount, r.cutoff_date
    into v_releasable, v_cutoff
  from club_releasable_amount(p_club_id) r;

  v_amount := least(coalesce(v_releasable, 0), greatest(coalesce(p_available_amount, 0), 0))::integer;

  if v_amount <= 0 then
    return;
  end if;

  insert into club_payouts (
    club_id, amount, currency, period_end, status, stripe_account_id, origin
  ) values (
    p_club_id, v_amount, upper(coalesce(p_currency, 'NOK')), v_cutoff, 'creating',
    p_stripe_account_id, 'tickethalo'
  )
  returning * into v_row;

  return query select v_row.id, v_row.amount, false, v_row.created_at, v_releasable;
end;
$$;

comment on function reserve_club_payout is
  'Reserverer neste utbetaling for en klubb atomisk. Returnerer ingen rad når '
  'det ikke er noe å utbetale, og en eksisterende `creating`-rad (resumed = true) '
  'når en tidligere kjøring ikke fikk bekreftet sin.';

-- ─────────────────────────────────────────────────────────────
-- show_sales_summary — det bookeren må se før sletting/stenging
-- ─────────────────────────────────────────────────────────────
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
  open_dispute_orders    integer
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
         and o.dispute_status not in ('won', 'lost', 'warning_closed', 'prevented'));
$$;

-- ─────────────────────────────────────────────────────────────
-- delete_show — den eneste veien et show forsvinner
--
-- Låser showet (samme lås som complete_checkout_order tar), slik at
-- et kjøp ikke kan smette inn mellom sjekken og slettingen.
--
--   blocked  = det finnes betalte ordrer, gyldige/brukte billetter
--              eller betalinger som ikke er refundert. Ingenting endres.
--   archived = alt er refundert, men showet har salgs- eller honorar-
--              historikk. Showet skjules og kanselleres; radene står.
--   deleted  = showet har aldri hatt en ordre eller et fakturagrunnlag.
-- ─────────────────────────────────────────────────────────────
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
     or v_summary.open_dispute_orders > 0 then
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

comment on function delete_show is
  'Sletter et show bare når alle betalinger er refundert. Show med '
  'salgshistorikk arkiveres (deleted_at) i stedet for å fjernes.';

-- ─────────────────────────────────────────────────────────────
-- complete_checkout_order — samme signatur som 036
--
-- Endringer:
--  * Et show som ikke finnes gir en ordre uten show_id (før: brudd på
--    fremmednøkkelen, 500 til Stripe og evige nye forsøk).
--  * Arkiverte show behandles som ugyldige.
--  * Ordrer uten billetter får `cancellation_reason` og havner i
--    refusjonskøen.
--  * Gebyrstatus i stedet for true-up-status.
-- ─────────────────────────────────────────────────────────────
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

comment on function complete_checkout_order is
  'Bokfører en betalt checkout-sesjon: kunde, ordre og én billett per '
  'plass i bestillingen. Idempotent på sesjons-ID. Betalinger som ikke kan '
  'gi billetter lagres som cancelled med cancellation_reason og refunderes.';

-- ─────────────────────────────────────────────────────────────
-- 5. Plattformens egen hovedbok hos Stripe
--
-- Speiler plattformkontoens balansetransaksjoner: provisjon inn
-- (application_fee), provisjon tilbake (application_fee_refund) og
-- Stripe-gebyrer (reporting_category = fee). Dette er Tickethalos
-- faktiske inntekt og kostnad, og summerer eksakt til Stripe-saldoen.
-- ─────────────────────────────────────────────────────────────
create table if not exists platform_balance_transactions (
  id                   text primary key,
  livemode             boolean not null,
  type                 text not null,
  reporting_category   text not null,
  amount               integer not null,
  fee                  integer not null default 0,
  net                  integer not null,
  currency             text not null,
  source_id            text,
  description          text,
  connected_account_id text,
  charge_id            text,
  created_at_stripe    timestamptz not null,
  available_on         timestamptz,
  synced_at            timestamptz not null default now()
);

comment on table platform_balance_transactions is
  'Speil av Tickethalos egne Stripe-balansetransaksjoner. Stripe-gebyrer for '
  'klubbenes betalinger kommer som samleposter (type stripe_fee) uten kobling '
  'til betalingen — fordeling per ordre står i stripe_fee_entries.';

create index if not exists idx_platform_bt_created on platform_balance_transactions(livemode, created_at_stripe desc);
create index if not exists idx_platform_bt_category on platform_balance_transactions(reporting_category, created_at_stripe);

-- Stripes gebyrrapport (all_fees.*.itemized), én rad per gebyrlinje.
create table if not exists stripe_fee_entries (
  id                      uuid primary key default gen_random_uuid(),
  livemode                boolean not null,
  row_key                 text not null unique,
  report_run_id           text not null,
  balance_transaction_id  text,
  fee_transaction_id      text,
  incurred_by             text,
  incurred_by_type        text,
  incurred_at             timestamptz,
  order_id                uuid references orders(id) on delete restrict,
  amount                  integer not null,
  tax_amount              integer not null default 0,
  currency                text not null,
  product                 text,
  feature_name            text,
  fee_description         text,
  created_at              timestamptz not null default now()
);

comment on table stripe_fee_entries is
  'Gebyrlinjer fra Stripes Fees report. incurred_by er objektet som utløste '
  'gebyret (charge, refund, payout, dispute …). Linjer for en betaling knyttes '
  'til ordren og summeres til orders.stripe_fee_amount.';

create index if not exists idx_stripe_fee_entries_incurred_by on stripe_fee_entries(incurred_by);
create index if not exists idx_stripe_fee_entries_order on stripe_fee_entries(order_id);

create table if not exists stripe_fee_report_runs (
  id              uuid primary key default gen_random_uuid(),
  livemode        boolean not null,
  report_run_id   text not null unique,
  report_type     text not null,
  interval_start  timestamptz not null,
  interval_end    timestamptz not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'processed', 'failed')),
  error           text,
  row_count       integer,
  processed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_stripe_fee_report_runs_status on stripe_fee_report_runs(status, interval_end desc);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_stripe_fee_report_runs_updated_at') then
    create trigger trg_stripe_fee_report_runs_updated_at
      before update on stripe_fee_report_runs
      for each row execute function update_updated_at();
  end if;
end;
$$;

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
-- RLS og rettigheter
--
-- Appen bruker service role. Plattformtabellene er Tickethalos egne
-- tall og skal bare kunne leses av superadmin via RLS.
-- ─────────────────────────────────────────────────────────────
alter table platform_balance_transactions enable row level security;
alter table stripe_fee_entries            enable row level security;
alter table stripe_fee_report_runs        enable row level security;

drop policy if exists "Superadmin reads platform balance transactions" on platform_balance_transactions;
create policy "Superadmin reads platform balance transactions"
  on platform_balance_transactions for select
  using (is_superadmin());

drop policy if exists "Superadmin reads stripe fee entries" on stripe_fee_entries;
create policy "Superadmin reads stripe fee entries"
  on stripe_fee_entries for select
  using (is_superadmin());

drop policy if exists "Superadmin reads stripe fee report runs" on stripe_fee_report_runs;
create policy "Superadmin reads stripe fee report runs"
  on stripe_fee_report_runs for select
  using (is_superadmin());

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
