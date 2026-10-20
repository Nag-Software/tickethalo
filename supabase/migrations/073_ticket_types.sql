-- ============================================================
-- Migration 073: Billettyper
--
-- Et show hadde én pris (`shows.ticket_price`) og én kapasitet. Klubbene vil
-- selge Student, Early-bird og lignende side om side, så prisen flytter ut i
-- `show_ticket_types`: navn, pris, rabatt, eget antall, en kode som låser
-- typen opp, og hvor lenge typen selges.
--
-- `shows.capacity` står igjen som taket for hele showet (salen), og
-- `shows.ticket_price` blir en avledet «fra»-pris som triggeren under holder
-- ved like. Lister, plakater og publiseringssjekken leser den som før.
--
-- Ordren får linjer (`order_items`): hva kjøperen betalte per type, låst ved
-- kjøpet. Provisjonen på en linje er regnet av prisen kjøperen faktisk
-- betaler etter typens rabatt; ordrens provisjon er summen av linjene, så
-- hovedboken og alt som leser ordrebeløp er uendret.
--
-- Salget stopper nå når showet starter, ikke når datoen er passert. Det er
-- standarden for hver type («until event start») og gjelder også showene som
-- fantes før — de får én «Standard»-type med den innstillingen.
--
-- Ordren får også kjøperens telefon fra Stripe og om kjøperen vil ha e-post
-- om nye show. Samtykket ligger på ordren, ikke på kunden: kunden er felles
-- for alle klubber, og samtykket gjelder klubben som solgte billetten.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- show_ticket_types
-- ─────────────────────────────────────────────────────────────
create table if not exists show_ticket_types (
  id                 uuid primary key default gen_random_uuid(),
  show_id            uuid not null references shows(id) on delete cascade,
  name               text not null,
  -- Full pris i minste valutaenhet. 0 = gratis.
  price              integer not null,
  -- Rabatt i basispunkter: 2500 = 25 %.
  discount_bps       integer not null default 0,
  -- Det kjøperen betaler per billett. Regnes her og bare her, så checkout,
  -- oppgjøret og visningen aldri kan runde ulikt.
  unit_amount        integer generated always as (
                       round(price::numeric * (10000 - discount_bps) / 10000)::integer
                     ) stored,
  -- Hvor mange av typen som kan selges. Null = bare showets kapasitet.
  quantity           integer,
  -- Låser typen opp. Lagres med store bokstaver uten mellomrom rundt;
  -- null = offentlig.
  promo_code         text,
  sales_end_mode     text not null default 'event_start',
  sales_end_days     integer,
  sales_end_at       timestamptz,
  position           integer not null default 0,
  -- Stripe-produktet typen selges som på klubbens konto. Navnet på
  -- betalingssiden er «Show · Type», så det nullstilles når et av dem endres.
  stripe_product_id  text,
  -- En type med salg slettes ikke, den arkiveres: billettene peker på den.
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint show_ticket_types_name_check check (length(btrim(name)) between 1 and 60),
  constraint show_ticket_types_price_check check (price >= 0),
  constraint show_ticket_types_discount_check check (discount_bps between 0 and 10000),
  constraint show_ticket_types_quantity_check check (quantity is null or quantity >= 0),
  constraint show_ticket_types_promo_code_check check (
    promo_code is null
    or (promo_code = upper(btrim(promo_code)) and length(promo_code) between 1 and 40)
  ),
  constraint show_ticket_types_sales_end_mode_check check (
    sales_end_mode in ('event_start', 'event_end', 'days_before', 'custom')
  ),
  constraint show_ticket_types_sales_end_days_check check (
    (sales_end_mode = 'days_before') = (sales_end_days is not null)
    and (sales_end_days is null or sales_end_days between 1 and 365)
  ),
  constraint show_ticket_types_sales_end_at_check check (
    (sales_end_mode = 'custom') = (sales_end_at is not null)
  )
);

create index if not exists show_ticket_types_show_idx on show_ticket_types (show_id, position);

comment on table show_ticket_types is
  'Billettypene på et show. Prisen kjøperen betaler er unit_amount (pris minus rabatt). '
  'shows.capacity er taket for hele showet; quantity er taket for typen.';
comment on column show_ticket_types.promo_code is
  'Koden som låser typen opp på bestillingsarket. Null = offentlig. Sendes aldri til nettleseren.';
comment on column show_ticket_types.sales_end_mode is
  'event_start (standard), event_end, days_before (sales_end_days før start) eller custom (sales_end_at, '
  'aldri senere enn slutten). Se ticket_type_sales_end.';

drop trigger if exists trg_show_ticket_types_updated_at on show_ticket_types;
create trigger trg_show_ticket_types_updated_at
  before update on show_ticket_types
  for each row execute function update_updated_at();

alter table show_ticket_types enable row level security;

drop policy if exists "Superadmin manage ticket types" on show_ticket_types;
create policy "Superadmin manage ticket types"
  on show_ticket_types for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "Club admins manage own ticket types" on show_ticket_types;
create policy "Club admins manage own ticket types"
  on show_ticket_types for all
  using (exists (
    select 1 from shows s
    where s.id = show_ticket_types.show_id
      and s.club_id is not null and is_club_member(s.club_id)
  ))
  with check (exists (
    select 1 from shows s
    where s.id = show_ticket_types.show_id
      and s.club_id is not null and is_club_member(s.club_id)
  ));
-- Ingen offentlig policy: de offentlige sidene leser typene på serveren og
-- sender dem videre uten promokoden.

-- ─────────────────────────────────────────────────────────────
-- order_items
-- ─────────────────────────────────────────────────────────────
create table if not exists order_items (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references orders(id) on delete cascade,
  ticket_type_id       uuid references show_ticket_types(id) on delete set null,
  -- Navnet slik det var ved kjøpet. Typen kan døpes om eller arkiveres.
  type_name            text not null,
  quantity             integer not null check (quantity > 0),
  -- Det kjøperen betalte per billett, etter rabatt.
  unit_amount          integer not null check (unit_amount >= 0),
  -- Provisjonen for hele linjen: commissionFor(unit_amount) × quantity.
  platform_fee_amount  integer,
  created_at           timestamptz not null default now()
);

create index if not exists order_items_order_idx on order_items (order_id);
create index if not exists order_items_type_idx on order_items (ticket_type_id);

comment on table order_items is
  'Linjene i en ordre, låst ved kjøpet. Σ unit_amount × quantity = orders.gross_amount, '
  'Σ platform_fee_amount = orders.platform_fee_amount.';

alter table order_items enable row level security;

drop policy if exists "Superadmin manage order items" on order_items;
create policy "Superadmin manage order items"
  on order_items for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "Club admins read own order items" on order_items;
create policy "Club admins read own order items"
  on order_items for select
  using (exists (
    select 1 from orders o
    where o.id = order_items.order_id
      and o.club_id is not null and is_club_member(o.club_id)
  ));

-- ─────────────────────────────────────────────────────────────
-- tickets og orders
-- ─────────────────────────────────────────────────────────────
alter table tickets
  add column if not exists ticket_type_id uuid references show_ticket_types(id) on delete set null,
  add column if not exists unit_amount    integer;

create index if not exists tickets_ticket_type_idx on tickets (ticket_type_id) where ticket_type_id is not null;

comment on column tickets.ticket_type_id is 'Typen billetten ble solgt som. Null på billetter uten type.';
comment on column tickets.unit_amount is 'Det kjøperen betalte for denne billetten, etter rabatt.';

alter table orders
  add column if not exists buyer_phone         text,
  add column if not exists marketing_opt_in    boolean not null default false,
  add column if not exists marketing_opt_in_at timestamptz;

comment on column orders.buyer_phone is 'Telefonnummeret kjøperen oppga hos Stripe. Null på gratisordrer.';
comment on column orders.marketing_opt_in is
  'Kjøperen krysset av for e-post om nye show fra klubben (club_id). Av som standard. '
  'Gjelder klubben, ikke Tickethalo — derfor her og ikke på customers.';

-- ─────────────────────────────────────────────────────────────
-- Salgsslutt
--
-- Showets tider er norsk veggklokke. Uten starttid starter showet (for
-- salgets del) ved midnatt etter datoen — det samme som regelen før, der
-- salget stoppet når datoen var passert. En sluttid som ikke er etter
-- starttiden er etter midnatt, neste dag.
--
-- Speilet i TypeScript i lib/ticket-sales.ts (eventStartsAt, eventEndsAt)
-- og lib/ticket-types.ts (ticketTypeSalesEndsAt).
-- ─────────────────────────────────────────────────────────────
create or replace function show_event_starts_at(p_date date, p_start time)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when p_start is null then (p_date + 1)::timestamp at time zone 'Europe/Oslo'
    else (p_date + p_start) at time zone 'Europe/Oslo'
  end
$$;

create or replace function show_event_ends_at(p_date date, p_start time, p_end time)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case
    when p_end is null then greatest(
      (p_date + 1)::timestamp at time zone 'Europe/Oslo',
      show_event_starts_at(p_date, p_start)
    )
    when p_start is not null and p_end <= p_start then (p_date + 1 + p_end) at time zone 'Europe/Oslo'
    else (p_date + p_end) at time zone 'Europe/Oslo'
  end
$$;

create or replace function ticket_type_sales_end(
  p_mode text,
  p_days integer,
  p_at timestamptz,
  p_date date,
  p_start time,
  p_end time
)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select case p_mode
    when 'event_end' then show_event_ends_at(p_date, p_start, p_end)
    when 'days_before' then show_event_starts_at(p_date, p_start) - make_interval(days => coalesce(p_days, 0))
    when 'custom' then least(coalesce(p_at, show_event_starts_at(p_date, p_start)), show_event_ends_at(p_date, p_start, p_end))
    else show_event_starts_at(p_date, p_start)
  end
$$;

-- ─────────────────────────────────────────────────────────────
-- Eksisterende show: én «Standard»-type
-- ─────────────────────────────────────────────────────────────
insert into show_ticket_types (show_id, name, price, position)
select s.id, 'Standard', s.ticket_price, 0
from shows s
where s.ticket_price is not null
  and s.ticket_price >= 0
  and not exists (select 1 from show_ticket_types t where t.show_id = s.id);

update tickets t
set ticket_type_id = tt.id,
    unit_amount = tt.unit_amount
from show_ticket_types tt
where tt.show_id = t.show_id
  and t.ticket_type_id is null;

-- Linjer for ordrene som har billetter. Beløpet deles likt på billettene;
-- gamle ordrer hadde én pris.
insert into order_items (order_id, ticket_type_id, type_name, quantity, unit_amount, platform_fee_amount)
select o.id,
       tt.id,
       coalesce(tt.name, 'Standard'),
       c.ticket_count,
       coalesce(o.gross_amount, o.amount_total, 0) / c.ticket_count,
       o.platform_fee_amount
from orders o
join (
  select order_id, count(*)::integer as ticket_count, min(ticket_type_id::text)::uuid as ticket_type_id
  from tickets
  group by order_id
) c on c.order_id = o.id
left join show_ticket_types tt on tt.id = c.ticket_type_id
where not exists (select 1 from order_items oi where oi.order_id = o.id);

-- ─────────────────────────────────────────────────────────────
-- shows.ticket_price — avledet «fra»-pris
--
-- Laveste pris blant aktive offentlige typer, ellers blant alle aktive
-- (et show der alt krever kode, selges fortsatt). Null uten typer.
-- ─────────────────────────────────────────────────────────────
create or replace function refresh_show_ticket_price(p_show_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update shows s
  set ticket_price = (
    select coalesce(
      min(t.unit_amount) filter (where t.promo_code is null),
      min(t.unit_amount)
    )
    from show_ticket_types t
    where t.show_id = p_show_id
      and t.archived_at is null
  )
  where s.id = p_show_id
$$;

create or replace function trg_show_ticket_types_refresh_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform refresh_show_ticket_price(old.show_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.show_id <> old.show_id) then
    perform refresh_show_ticket_price(new.show_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_show_ticket_types_price on show_ticket_types;
create trigger trg_show_ticket_types_price
  after insert or update or delete on show_ticket_types
  for each row execute function trg_show_ticket_types_refresh_price();

comment on column shows.ticket_price is
  'Avledet fra show_ticket_types (laveste pris kjøperen betaler, offentlige typer først). '
  'Skrives av triggeren trg_show_ticket_types_price — ikke sett den direkte.';

-- ─────────────────────────────────────────────────────────────
-- complete_checkout_order — linjer per billettype
--
-- Samme funksjon som i migrasjon 068, med `p_items`:
--   [{"type_id": uuid, "quantity": int, "unit_amount": int, "platform_fee_amount": int}]
--
-- Beløpene er det Stripe faktisk belastet (fra sesjonen), ikke prisen nå:
-- endrer bookeren prisen mens kjøperen betaler, skal ordren vise det hun
-- betalte. Under låsen på showet sjekkes det som kan ha endret seg: at
-- typen fortsatt selges (ikke arkivert, salgsslutt ikke passert), at typens
-- antall og showets kapasitet har plass, og — for gratisordrer — at typen
-- fortsatt er gratis.
--
-- Uten `p_items` (sesjoner laget før denne migrasjonen) er det showets
-- første aktive type, `p_quantity` billetter, beløpet delt likt.
-- ─────────────────────────────────────────────────────────────
drop function if exists complete_checkout_order(
  uuid, text, text, text, integer, text, text, text, uuid, text, text, text, integer, text, integer, text[]
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
  p_ticket_names text[] default null,
  p_items jsonb default null,
  p_buyer_phone text default null,
  p_marketing_opt_in boolean default false
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
  v_show_found boolean;
  v_customer_id uuid;
  v_order_id uuid;
  v_ticket_code text;
  v_ticket_codes text[];
  v_club_id uuid;
  v_reason text;
  v_fee_status text;
  v_vat_bps integer;
  v_vat_amount integer;
  v_items jsonb;
  v_lines jsonb;
  v_item record;
  v_total_quantity integer;
  v_show_sold integer;
  v_type_sold integer;
  v_index integer;
  v_ticket_number integer := 0;
  v_holder text;
  v_free boolean;
  v_phone text;
  v_opt_in boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_session_id, 0));

  v_fee_status := case
    when p_payment_intent_id is null or p_connected_account_id is null then 'not_applicable'
    else 'pending'
  end;
  v_free := p_session_id like 'free\_%';
  v_phone := nullif(btrim(coalesce(p_buyer_phone, '')), '');
  v_opt_in := coalesce(p_marketing_opt_in, false);

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
  v_club_id := coalesce(p_club_id, v_show.club_id);

  -- Linjene: fra kallet, ellers showets første aktive type.
  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    v_items := p_items;
  elsif v_show_found then
    select jsonb_build_array(jsonb_build_object(
      'type_id', t.id,
      'quantity', greatest(1, coalesce(p_quantity, 1)),
      'unit_amount', coalesce(p_amount_total, 0) / greatest(1, coalesce(p_quantity, 1)),
      'platform_fee_amount', p_platform_fee_amount
    ))
    into v_items
    from show_ticket_types t
    where t.show_id = p_show_id
    order by (t.archived_at is null) desc, t.position, t.created_at
    limit 1;
  end if;

  if v_items is null then
    v_items := jsonb_build_array(jsonb_build_object(
      'type_id', null,
      'quantity', greatest(1, coalesce(p_quantity, 1)),
      'unit_amount', coalesce(p_amount_total, 0) / greatest(1, coalesce(p_quantity, 1)),
      'platform_fee_amount', p_platform_fee_amount
    ));
  end if;

  -- Én linje per type, med typen slik den står nå.
  select coalesce(jsonb_agg(jsonb_build_object(
           'type_id', i.type_id,
           'quantity', i.quantity,
           'unit_amount', i.unit_amount,
           'platform_fee_amount', i.platform_fee_amount,
           'type_name', coalesce(t.name, 'Ticket'),
           'type_found', t.id is not null,
           'type_quantity', t.quantity,
           'type_unit_amount', t.unit_amount,
           'archived', t.archived_at is not null,
           'sales_end', case when t.id is null then null else ticket_type_sales_end(
             t.sales_end_mode, t.sales_end_days, t.sales_end_at,
             v_show.date, v_show.start_time, v_show.end_time
           ) end
         ) order by coalesce(t.position, 0), coalesce(t.name, 'Ticket')), '[]'::jsonb)
    into v_lines
  from (
    select (e->>'type_id')::uuid as type_id,
           sum(greatest(0, coalesce((e->>'quantity')::integer, 0)))::integer as quantity,
           max(greatest(0, coalesce((e->>'unit_amount')::integer, 0)))::integer as unit_amount,
           sum((e->>'platform_fee_amount')::integer)::integer as platform_fee_amount
    from jsonb_array_elements(v_items) e
    group by (e->>'type_id')::uuid
  ) i
  left join show_ticket_types t on t.id = i.type_id and t.show_id = p_show_id
  where i.quantity > 0;

  select coalesce(sum(l.quantity), 0) into v_total_quantity from jsonb_to_recordset(v_lines) as l(type_id uuid, quantity integer, unit_amount integer, platform_fee_amount integer, type_name text, type_found boolean, type_quantity integer, type_unit_amount integer, archived boolean, sales_end timestamptz);
  if v_total_quantity < 1 then
    raise exception 'complete_checkout_order: no tickets in session %', p_session_id;
  end if;

  -- Gratis er gratis bare om typen fortsatt er det. Skjemaet sjekker før
  -- kallet; dette er for prisen som ble endret i mellomtiden.
  if v_free and exists (
    select 1 from jsonb_to_recordset(v_lines) as l(type_id uuid, quantity integer, unit_amount integer, platform_fee_amount integer, type_name text, type_found boolean, type_quantity integer, type_unit_amount integer, archived boolean, sales_end timestamptz) where not l.type_found or l.type_unit_amount <> 0
  ) then
    raise exception 'complete_checkout_order: free order % contains a ticket type that is not free', p_session_id;
  end if;

  if not v_show_found
     or v_show.deleted_at is not null
     or v_show.status <> 'published'
     or v_show.date < (now() at time zone 'Europe/Oslo')::date then
    v_reason := 'invalid_show';
  elsif v_show.ticket_sales_closed_at is not null then
    -- Bookeren har stengt salget. Betalingen lagres uten billetter og
    -- refunderes automatisk.
    v_reason := 'sales_closed';
  elsif exists (
    select 1 from jsonb_to_recordset(v_lines) as l(type_id uuid, quantity integer, unit_amount integer, platform_fee_amount integer, type_name text, type_found boolean, type_quantity integer, type_unit_amount integer, archived boolean, sales_end timestamptz)
    where l.type_id is not null
      and (not l.type_found or l.archived or now() >= l.sales_end)
  ) then
    -- Typen er arkivert eller salgsperioden er over. Samme løfte som når
    -- bookeren stenger: ingen billett etter slutt.
    v_reason := 'sales_closed';
  else
    -- Hele bestillingen må få plass, både i showet og i hver type.
    select count(*) into v_show_sold
    from tickets
    where show_id = p_show_id
      and status in ('valid', 'used');

    if v_show.capacity is not null and v_show_sold + v_total_quantity > v_show.capacity then
      v_reason := 'sold_out';
    else
      for v_item in select * from jsonb_to_recordset(v_lines) as l(type_id uuid, quantity integer, unit_amount integer, platform_fee_amount integer, type_name text, type_found boolean, type_quantity integer, type_unit_amount integer, archived boolean, sales_end timestamptz) where l.type_id is not null and l.type_quantity is not null loop
        select count(*) into v_type_sold
        from tickets
        where ticket_type_id = v_item.type_id
          and status in ('valid', 'used');

        if v_type_sold + v_item.quantity > v_item.type_quantity then
          v_reason := 'sold_out';
          exit;
        end if;
      end loop;
    end if;
  end if;

  if v_reason is null and p_buyer_email is not null and length(trim(p_buyer_email)) > 0 then
    select id into v_customer_id
    from customers
    where lower(email) = lower(p_buyer_email)
    order by created_at asc
    limit 1;

    if v_customer_id is null then
      insert into customers (email, name, phone, stripe_customer_id)
      values (p_buyer_email, nullif(p_buyer_name, ''), v_phone, p_stripe_customer_id)
      returning id into v_customer_id;
    elsif v_phone is not null then
      update customers set phone = v_phone where id = v_customer_id and phone is null;
    end if;
  end if;

  -- Momsen ligger inne i prisen kunden betalte. Kansellerte ordrer er ikke
  -- inntekt og får ingen moms.
  if v_reason is null then
    select c.ticket_vat_bps into v_vat_bps from clubs c where c.id = v_club_id;
    v_vat_bps := coalesce(v_vat_bps, 0);
    v_vat_amount := round((p_amount_total::numeric * v_vat_bps) / (10000 + v_vat_bps));
  end if;

  insert into orders (
    show_id, club_id, customer_id, stripe_checkout_session_id,
    stripe_payment_intent_id, stripe_customer_id, stripe_connected_account_id,
    stripe_charge_id, stripe_application_fee_id, amount_total, gross_amount,
    platform_fee_amount, club_net_amount, ticket_vat_amount, stripe_fee_status, payment_method_type,
    currency, status, cancellation_reason, buyer_email, buyer_name, buyer_phone,
    marketing_opt_in, marketing_opt_in_at
  ) values (
    case when v_show_found then p_show_id else null end, v_club_id, v_customer_id, p_session_id,
    p_payment_intent_id, p_stripe_customer_id, p_connected_account_id,
    p_charge_id, p_application_fee_id, p_amount_total, p_amount_total,
    p_platform_fee_amount,
    case when v_reason is null and p_platform_fee_amount is not null
         then p_amount_total - p_platform_fee_amount end,
    v_vat_amount,
    v_fee_status,
    p_payment_method_type,
    upper(coalesce(p_currency, 'NOK')),
    case when v_reason is null then 'paid' else 'cancelled' end,
    v_reason,
    p_buyer_email, p_buyer_name, v_phone,
    v_opt_in, case when v_opt_in then now() end
  )
  returning id into v_order_id;

  -- Linjene lagres også på kansellerte ordrer: de viser hva som ble betalt
  -- og skal refunderes.
  insert into order_items (order_id, ticket_type_id, type_name, quantity, unit_amount, platform_fee_amount)
  select v_order_id,
         case when l.type_found then l.type_id end,
         l.type_name, l.quantity, l.unit_amount, l.platform_fee_amount
  from jsonb_to_recordset(v_lines) as l(type_id uuid, quantity integer, unit_amount integer, platform_fee_amount integer, type_name text, type_found boolean, type_quantity integer, type_unit_amount integer, archived boolean, sales_end timestamptz);

  if v_reason is not null then
    return query select v_reason, v_order_id, null::text, null::text[], false;
    return;
  end if;

  v_ticket_codes := array[]::text[];

  for v_item in select * from jsonb_to_recordset(v_lines) as l(type_id uuid, quantity integer, unit_amount integer, platform_fee_amount integer, type_name text, type_found boolean, type_quantity integer, type_unit_amount integer, archived boolean, sales_end timestamptz) loop
    for v_index in 1..v_item.quantity loop
      v_ticket_number := v_ticket_number + 1;
      -- Mangler navnet, står kjøperens eget. En navnløs billett i døra
      -- hjelper ingen.
      v_holder := nullif(trim(coalesce(p_ticket_names[v_ticket_number], '')), '');

      insert into tickets (show_id, order_id, customer_id, status, holder_name, ticket_type_id, unit_amount)
      values (p_show_id, v_order_id, v_customer_id, 'valid',
              coalesce(v_holder, nullif(trim(coalesce(p_buyer_name, '')), '')),
              case when v_item.type_found then v_item.type_id end,
              v_item.unit_amount)
      returning tickets.ticket_code into v_ticket_code;

      v_ticket_codes := v_ticket_codes || v_ticket_code;
    end loop;
  end loop;

  return query select 'created'::text, v_order_id, v_ticket_codes[1], v_ticket_codes, false;
end;
$$;

-- Bare serveren (service role) bokfører kjøp — samme tilgang som før.
revoke all on function complete_checkout_order(
  uuid, text, text, text, integer, text, text, text, uuid, text, text, text, integer, text, integer, text[], jsonb, text, boolean
) from public, anon, authenticated;
grant execute on function complete_checkout_order(
  uuid, text, text, text, integer, text, text, text, uuid, text, text, text, integer, text, integer, text[], jsonb, text, boolean
) to service_role;

revoke all on function refresh_show_ticket_price(uuid) from public, anon, authenticated;
grant execute on function refresh_show_ticket_price(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────
-- ticket_type_counts — solgte billetter per type, som show_ticket_counts
-- ─────────────────────────────────────────────────────────────
create or replace view ticket_type_counts
  with (security_invoker = true)
as
select
  ticket_type_id,
  show_id,
  count(*)::int as sold_tickets
from tickets
where status in ('valid', 'used')
  and ticket_type_id is not null
group by ticket_type_id, show_id;

comment on view ticket_type_counts is
  'Solgte billetter per billettype (status valid/used). Bestillingsarket viser hvor mange som er igjen av hver.';
