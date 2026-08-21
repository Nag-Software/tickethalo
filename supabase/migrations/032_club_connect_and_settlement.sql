-- ============================================================
-- Migration 032: Stripe Connect, hovedbok per ordre og oppgjør
--
-- Klubben er selger og arrangør av showet. Tickethalo formidler
-- adgangen og mottar en formidlingsprovisjon per solgt billett.
-- Betalingen opprettes derfor PÅ klubbens Connect-konto (direct
-- charge) — pengene treffer aldri Tickethalos balanse, og
-- Tickethalos eneste inntekt er provisjonen.
--
-- Feltene her er hovedboken som gjør at oppgjøret kan avstemmes
-- uten å spørre Stripe, og at hver klubb kan gjøres opp for seg.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- clubs — juridisk identitet og oppgjørsparametre
-- ─────────────────────────────────────────────────────────────
alter table clubs
  add column if not exists legal_name             text,
  add column if not exists org_number             text,
  add column if not exists support_email          text,
  add column if not exists stripe_account_id      text unique,
  add column if not exists charges_enabled        boolean not null default false,
  add column if not exists payouts_enabled        boolean not null default false,
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists requirements_due       jsonb,
  add column if not exists platform_fee_bps       integer not null default 1000,
  add column if not exists commission_vat_bps     integer not null default 0,
  add column if not exists payout_hold_days       integer not null default 2,
  add column if not exists absorb_stripe_fee      boolean not null default true;

comment on column clubs.legal_name is
  'Juridisk navn. Står som selger på billetten og i kjøpsvilkårene.';
comment on column clubs.org_number is
  'Organisasjonsnummer. Selgeridentifikasjon på billett-e-posten.';
comment on column clubs.platform_fee_bps is
  'Formidlingsprovisjon i basispunkter. 1000 = 10 %. Per klubb, slik at '
  'avvikende avtaler ikke krever kodeendring.';
comment on column clubs.commission_vat_bps is
  'Mva på formidlingsprovisjonen. 0 = unntatt etter mval. § 3-7 '
  '(formidling av adgang til kulturarrangement). Feltet finnes for at et '
  'annet svar fra Skatteetaten blir en dataendring, ikke en ombygging.';
comment on column clubs.payout_hold_days is
  'Dager etter showdato før utbetaling frigis. Beskytter mot avlysning '
  'etter at pengene er utbetalt — plattformen hefter for negativ saldo.';
comment on column clubs.absorb_stripe_fee is
  'True = Tickethalo dekker Stripe-gebyret av sin provisjon, slik at '
  'klubben lander på nøyaktig 90 %. Se lib/stripe/fee-settlement.ts.';

alter table clubs
  drop constraint if exists clubs_platform_fee_bps_check;
alter table clubs
  add constraint clubs_platform_fee_bps_check
    check (platform_fee_bps between 0 and 10000);

alter table clubs
  drop constraint if exists clubs_commission_vat_bps_check;
alter table clubs
  add constraint clubs_commission_vat_bps_check
    check (commission_vat_bps between 0 and 10000);

alter table clubs
  drop constraint if exists clubs_payout_hold_days_check;
alter table clubs
  add constraint clubs_payout_hold_days_check
    check (payout_hold_days between 0 and 90);

-- ─────────────────────────────────────────────────────────────
-- orders — hovedbok per ordre
--
-- Beløpene lagres i minste valutaenhet, som `orders.amount_total`.
-- `gross_amount` er det kunden betalte, `club_net_amount` det
-- klubben sitter igjen med etter provisjon og gebyr-oppgjør.
-- ─────────────────────────────────────────────────────────────
alter table orders
  add column if not exists club_id                      uuid references clubs(id) on delete set null,
  add column if not exists stripe_connected_account_id  text,
  add column if not exists stripe_charge_id             text,
  add column if not exists stripe_application_fee_id    text,
  add column if not exists gross_amount                 integer,
  add column if not exists platform_fee_amount          integer,
  add column if not exists stripe_fee_amount            integer,
  add column if not exists club_net_amount              integer,
  add column if not exists fee_trueup_amount            integer,
  add column if not exists fee_trueup_status            text not null default 'not_needed',
  add column if not exists payment_method_type          text,
  add column if not exists refunded_at                  timestamptz,
  add column if not exists refund_reason                text;

alter table orders
  drop constraint if exists orders_fee_trueup_status_check;
alter table orders
  add constraint orders_fee_trueup_status_check
    check (fee_trueup_status in ('pending', 'done', 'not_needed', 'capped', 'failed'));

comment on column orders.platform_fee_amount is
  'Formidlingsprovisjonen Tickethalo tok på denne ordren (application fee).';
comment on column orders.stripe_fee_amount is
  'Stripes behandlingsgebyr. Belastes klubbens konto av Stripe og '
  'kompenseres tilbake av Tickethalo — se fee_trueup_amount.';
comment on column orders.fee_trueup_amount is
  'Delrefusjon av provisjonen som dekker Stripe-gebyret, slik at klubben '
  'lander på nøyaktig sin andel. Kunden bærer aldri betalingsgebyret.';
comment on column orders.payment_method_type is
  'Settes ved finalize slik at ordrelisten slipper ett Stripe-kall per rad.';

create index if not exists idx_orders_club_id     on orders(club_id, created_at desc);
create index if not exists idx_orders_charge_id   on orders(stripe_charge_id);
create index if not exists idx_orders_fee_trueup  on orders(fee_trueup_status)
  where fee_trueup_status = 'pending';

-- ─────────────────────────────────────────────────────────────
-- club_payouts — én rad per frigjort utbetaling til klubbens bank
-- ─────────────────────────────────────────────────────────────
create table if not exists club_payouts (
  id               uuid primary key default gen_random_uuid(),
  club_id          uuid not null references clubs(id) on delete cascade,

  amount           integer not null,
  currency         text not null default 'NOK',

  stripe_payout_id text unique,
  period_start     date,
  period_end       date,

  status           text not null default 'pending'
                     check (status in ('pending', 'paid', 'failed', 'cancelled')),
  failure_reason   text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  paid_at          timestamptz
);

create index if not exists idx_club_payouts_club on club_payouts(club_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- club_settlements — avregningsnota per klubb per periode
--
-- Dokumentet klubbens regnskapsfører ber om, og Tickethalos eget
-- bilag for provisjonsinntekten.
-- ─────────────────────────────────────────────────────────────
create table if not exists club_settlements (
  id                    uuid primary key default gen_random_uuid(),
  club_id               uuid not null references clubs(id) on delete cascade,

  period_start          date not null,
  period_end            date not null,

  gross_amount          integer not null default 0,
  commission_amount     integer not null default 0,
  commission_vat_amount integer not null default 0,
  refunded_amount       integer not null default 0,
  net_amount            integer not null default 0,
  currency              text not null default 'NOK',

  document_number       text unique,
  issued_at             timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (club_id, period_start, period_end)
);

create index if not exists idx_club_settlements_club
  on club_settlements(club_id, period_start desc);

-- ─────────────────────────────────────────────────────────────
-- updated_at-triggere (samme mønster som migrasjon 026)
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_club_payouts_updated_at') then
    create trigger trg_club_payouts_updated_at
      before update on club_payouts
      for each row execute function update_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_club_settlements_updated_at') then
    create trigger trg_club_settlements_updated_at
      before update on club_settlements
      for each row execute function update_updated_at();
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- RLS — samme modell som orders/tickets: admin via RLS, og
-- klubbavgrensning i appen via getClubAccess().
-- ─────────────────────────────────────────────────────────────
alter table club_payouts     enable row level security;
alter table club_settlements enable row level security;

drop policy if exists "Admins manage club payouts" on club_payouts;
create policy "Admins manage club payouts"
  on club_payouts for all
  using (is_admin());

drop policy if exists "Admins manage club settlements" on club_settlements;
create policy "Admins manage club settlements"
  on club_settlements for all
  using (is_admin());

-- ─────────────────────────────────────────────────────────────
-- complete_checkout_order — utvidet med hovedbok-feltene
--
-- Den gamle signaturen må droppes eksplisitt: `create or replace`
-- med ny argumentliste lager en overload, ikke en erstatning.
-- ─────────────────────────────────────────────────────────────
drop function if exists complete_checkout_order(uuid, text, text, text, integer, text, text, text);

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
  p_payment_method_type text default null
)
returns table (
  result text,
  order_id uuid,
  ticket_code text,
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
  v_sold_count integer;
  v_club_id uuid;
  v_show_found boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_session_id, 0));

  select o.id, t.ticket_code into v_order_id, v_ticket_code
  from orders o
  left join tickets t on t.order_id = o.id
  where o.stripe_checkout_session_id = p_session_id
  limit 1;

  if v_order_id is not null then
    return query select 'duplicate'::text, v_order_id, v_ticket_code, true;
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

    return query select 'invalid_show'::text, v_order_id, null::text, false;
    return;
  end if;

  select count(*) into v_sold_count
  from tickets
  where show_id = p_show_id
    and status in ('valid', 'used');

  if v_show.capacity is not null and v_sold_count >= v_show.capacity then
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

    return query select 'sold_out'::text, v_order_id, null::text, false;
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

  insert into tickets (show_id, order_id, customer_id, status)
  values (p_show_id, v_order_id, v_customer_id, 'valid')
  returning tickets.ticket_code into v_ticket_code;

  return query select 'created'::text, v_order_id, v_ticket_code, false;
end;
$$;
