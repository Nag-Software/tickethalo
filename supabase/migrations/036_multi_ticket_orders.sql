-- ============================================================
-- Migration 036: Flere billetter per ordre, med navn
--
-- Én ordre ga én billett. Skal to personer gå sammen, måtte de
-- gjennom betalingen to ganger — og i døra visste ingen hvem
-- billetten gjaldt, bare hvem som betalte.
--
-- Denne migrasjonen gir billetten et navn, og lar oppgjøret
-- lage flere av dem i samme kjøp. Kapasitetssjekken må da
-- gjelde hele bestillingen: fire billetter inn i et show med to
-- ledige plasser skal avvises samlet, ikke fylles delvis.
-- ============================================================

alter table tickets
  add column if not exists holder_name text;

comment on column tickets.holder_name is
  'Navnet på den billetten gjelder, oppgitt av kjøperen. Null for '
  'billetter kjøpt før migrasjon 036 — da er kjøperens navn det '
  'eneste vi har.';

-- Den gamle signaturen må droppes eksplisitt: `create or replace` med
-- ny argumentliste lager en overload, ikke en erstatning.
drop function if exists complete_checkout_order(
  uuid, text, text, text, integer, text, text, text, uuid, text, text, text, integer, text
);

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
begin
  perform pg_advisory_xact_lock(hashtextextended(p_session_id, 0));

  v_quantity := greatest(1, coalesce(p_quantity, 1));

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
  -- pengene tilhører for nettopp de radene som må ryddes manuelt.
  v_club_id := coalesce(p_club_id, v_show.club_id);

  if not v_show_found or v_show.status <> 'published' or v_show.date < current_date then
    insert into orders (
      show_id, club_id, stripe_checkout_session_id, stripe_payment_intent_id,
      stripe_customer_id, stripe_connected_account_id, stripe_charge_id,
      stripe_application_fee_id, amount_total, gross_amount, platform_fee_amount,
      payment_method_type, currency, status, buyer_email, buyer_name
    ) values (
      p_show_id, v_club_id, p_session_id, p_payment_intent_id,
      p_stripe_customer_id, p_connected_account_id, p_charge_id,
      p_application_fee_id, p_amount_total, p_amount_total, p_platform_fee_amount,
      p_payment_method_type, upper(coalesce(p_currency, 'NOK')), 'cancelled',
      p_buyer_email, p_buyer_name
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
  if v_show.capacity is not null and v_sold_count + v_quantity > v_show.capacity then
    insert into orders (
      show_id, club_id, stripe_checkout_session_id, stripe_payment_intent_id,
      stripe_customer_id, stripe_connected_account_id, stripe_charge_id,
      stripe_application_fee_id, amount_total, gross_amount, platform_fee_amount,
      payment_method_type, currency, status, buyer_email, buyer_name
    ) values (
      p_show_id, v_club_id, p_session_id, p_payment_intent_id,
      p_stripe_customer_id, p_connected_account_id, p_charge_id,
      p_application_fee_id, p_amount_total, p_amount_total, p_platform_fee_amount,
      p_payment_method_type, upper(coalesce(p_currency, 'NOK')), 'cancelled',
      p_buyer_email, p_buyer_name
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
    platform_fee_amount, club_net_amount, fee_trueup_status, payment_method_type,
    currency, status, buyer_email, buyer_name
  ) values (
    p_show_id, v_club_id, v_customer_id, p_session_id,
    p_payment_intent_id, p_stripe_customer_id, p_connected_account_id,
    p_charge_id, p_application_fee_id, p_amount_total, p_amount_total,
    p_platform_fee_amount,
    case when p_platform_fee_amount is null then null
         else p_amount_total - p_platform_fee_amount end,
    -- Gebyr-oppgjøret kjøres først når Stripe har bokført gebyret.
    case when p_application_fee_id is null then 'not_needed' else 'pending' end,
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
  'plass i bestillingen. Idempotent på sesjons-ID.';
