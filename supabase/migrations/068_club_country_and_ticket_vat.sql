-- ============================================================
-- Migration 068: Land og moms på billettsalget
--
-- Hovedboken har aldri kjent til moms, fordi adgang til kulturarrangement
-- er unntatt i Norge (mval. § 3-7). I Danmark er billetter til teater,
-- konserter og lignende momspliktige med 25 % (momsloven § 13 stk. 1 nr. 6
-- unntar dem ikke), i Sverige med 6 % (tillträde till föreställning).
-- Komikerens eget honorar er momsfritt i alle tre land.
--
-- Momsen rører ikke kontantstrømmen: klubben får fortsatt brutto minus
-- provisjon utbetalt (`club_releasable_amount` er uendret) og gjør opp
-- momsen selv. Men den skal ut av honorargrunnlaget — komikerne deler
-- klubbens inntekt, ikke pengene som skal videre til skattemyndigheten.
-- Derfor låses momsbeløpet på ordren ved kjøpet, med samme regel som
-- provisjonen: satsen leses fra klubben i kjøpsøyeblikket, og en endring
-- gjelder neste kjøp.
--
-- Landet avgjør også hvilket land Stripe-kontoen opprettes i; det var
-- hardkodet til Norge.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- clubs — land og sats
-- ─────────────────────────────────────────────────────────────
alter table clubs
  add column if not exists country        text    not null default 'NO',
  add column if not exists ticket_vat_bps integer not null default 0;

comment on column clubs.country is
  'ISO 3166-1 alpha-2. Landet klubben er registrert i. Styrer Stripe-kontoens '
  'land og standardsatsen for moms på billetter. Eksisterende klubber er norske.';
comment on column clubs.ticket_vat_bps is
  'Moms på billettsalget i basispunkter, regnet ut av prisen kunden betaler. '
  '0 = unntatt (Norge, mval. § 3-7). 2500 = Danmark, 600 = Sverige. Settes '
  'fra landet, men kan overstyres: en dansk forening eller svensk ideell '
  'förening kan være momsfri.';

alter table clubs
  drop constraint if exists clubs_country_check;
alter table clubs
  add constraint clubs_country_check
    check (country ~ '^[A-Z]{2}$');

alter table clubs
  drop constraint if exists clubs_ticket_vat_bps_check;
alter table clubs
  add constraint clubs_ticket_vat_bps_check
    check (ticket_vat_bps between 0 and 10000);

-- ─────────────────────────────────────────────────────────────
-- orders — momsen i det kunden betalte
-- ─────────────────────────────────────────────────────────────
alter table orders
  add column if not exists ticket_vat_amount integer;

comment on column orders.ticket_vat_amount is
  'Momsen som ligger i gross_amount, regnet ut av beløpet med klubbens sats '
  'ved kjøpet. Null på ordrer fra før kolonnen fantes — alle norske, altså 0. '
  'Trekkes fra club_net_amount i honorargrunnlaget; rører ikke utbetalingen.';

-- ─────────────────────────────────────────────────────────────
-- complete_checkout_order — låser momsen på ordren
--
-- Samme funksjon som i migrasjon 048, pluss `ticket_vat_amount` på den
-- betalte ordren. Kansellerte ordrer (invalid_show, sales_closed, sold_out)
-- er ikke inntekt og får ingen moms.
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
  v_vat_bps integer;
  v_vat_amount integer;
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

  -- Momsen ligger inne i prisen kunden betalte og regnes ut av den, med
  -- klubbens sats slik den er nå. Låses på ordren som provisjonen: en
  -- satsendring senere rører ikke denne ordren. 0 for norske klubber.
  select c.ticket_vat_bps into v_vat_bps from clubs c where c.id = v_club_id;
  v_vat_bps := coalesce(v_vat_bps, 0);
  v_vat_amount := round((p_amount_total::numeric * v_vat_bps) / (10000 + v_vat_bps));

  insert into orders (
    show_id, club_id, customer_id, stripe_checkout_session_id,
    stripe_payment_intent_id, stripe_customer_id, stripe_connected_account_id,
    stripe_charge_id, stripe_application_fee_id, amount_total, gross_amount,
    platform_fee_amount, club_net_amount, ticket_vat_amount, stripe_fee_status, payment_method_type,
    currency, status, buyer_email, buyer_name
  ) values (
    p_show_id, v_club_id, v_customer_id, p_session_id,
    p_payment_intent_id, p_stripe_customer_id, p_connected_account_id,
    p_charge_id, p_application_fee_id, p_amount_total, p_amount_total,
    p_platform_fee_amount,
    case when p_platform_fee_amount is null then null
         else p_amount_total - p_platform_fee_amount end,
    v_vat_amount,
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
