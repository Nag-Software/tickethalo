-- ============================================================
-- Migrasjon 090: annonsesamtykke og eksport av klubbens kontaktliste
--
-- E-postsamtykket fra 077 dekker e-post, ikke annonser. Å laste opp en
-- kundeliste til Meta (Custom Audience) er et eget formål og krever et eget
-- ja. Derfor egne felt, og aldri utledet av e-postsamtykket — ingen backfill.
--
-- Annonsesamtykket er et tillegg til en kontakt på e-postlista: checkout
-- viser boksen bare når e-postboksen er krysset av. Aktivt samtykke er
--   ads_consent_at is not null and ads_withdrawn_at is null
--   and unsubscribed_at is null
-- (samme regel som `isAdsAudience` i lib/marketing/contact-export.ts).
--
-- Tilbaketrukket blir stående med `ads_withdrawn_at`, som avmelding: raden
-- hindrer at en import gir samtykket tilbake. Bare et nytt ja ved et kjøp
-- nullstiller det.
--
-- Additiv: koden som er deployet leser ingen av feltene, og triggerne endrer
-- ikke hva den ser.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Ordren
-- ─────────────────────────────────────────────────────────────
alter table orders
  add column if not exists ads_opt_in    boolean not null default false,
  add column if not exists ads_opt_in_at timestamptz;

comment on column orders.ads_opt_in is
  'Kjøperen krysset av for annonser fra klubben på Facebook og Instagram. Av som standard, '
  'og bare mulig sammen med marketing_opt_in. Settes etter complete_checkout_order (se 090).';

-- ─────────────────────────────────────────────────────────────
-- Kontakten og importen
-- ─────────────────────────────────────────────────────────────
alter table club_contact_imports
  add column if not exists ads_consent_statement text;

comment on column club_contact_imports.ads_consent_statement is
  'Teksten klubben krysset av for om at folkene også har sagt ja til annonser. Null: ikke bekreftet.';

alter table club_contacts
  add column if not exists ads_consent_at        timestamptz,
  add column if not exists ads_consent_source    text,
  add column if not exists ads_consent_text      text,
  add column if not exists ads_consent_order_id  uuid references orders(id) on delete set null,
  add column if not exists ads_consent_import_id uuid references club_contact_imports(id) on delete set null,
  add column if not exists ads_withdrawn_at      timestamptz;

alter table club_contacts drop constraint if exists club_contacts_ads_consent_source_check;
alter table club_contacts
  add constraint club_contacts_ads_consent_source_check
  check (
    (ads_consent_at is null and ads_consent_source is null)
    or (ads_consent_at is not null and ads_consent_source in ('purchase', 'import'))
  );

comment on column club_contacts.ads_consent_at is
  'Da personen sa ja til annonser fra klubben på Facebook og Instagram. Null: aldri sagt ja. Se 090.';
comment on column club_contacts.ads_consent_text is
  'Ordlyden personen sa ja til, eller klubbens bekreftelse ved import.';
comment on column club_contacts.ads_withdrawn_at is
  'Annonsesamtykket er trukket tilbake (eller personen meldte seg av alt). Står igjen så en import ikke gir det tilbake.';

-- Meta-uttrekket og «Ads consent»-filteret.
create index if not exists idx_club_contacts_ads_audience
  on club_contacts (club_id)
  where ads_consent_at is not null and ads_withdrawn_at is null and unsubscribed_at is null;

-- ─────────────────────────────────────────────────────────────
-- Eksportloggen
--
-- Hvem som tok ut lista og når (GDPR art. 5(2)). En Meta-eksport er en
-- utlevering til en ny mottaker; klubben skal kunne vise når den skjedde.
-- ─────────────────────────────────────────────────────────────
create table if not exists club_contact_exports (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references clubs(id) on delete cascade,
  exported_by uuid references profiles(id) on delete set null,
  kind        text not null check (kind in ('contacts', 'meta')),
  filter      text,
  row_count   integer not null default 0,
  created_at  timestamptz not null default now()
);

comment on table club_contact_exports is
  'Én rad per nedlasting av klubbens kontaktliste: vanlig CSV (contacts) eller Meta-kundeliste (meta).';

create index if not exists idx_club_contact_exports_club on club_contact_exports (club_id, created_at desc);

alter table club_contact_exports enable row level security;

drop policy if exists "Superadmin manage contact exports" on club_contact_exports;
create policy "Superadmin manage contact exports"
  on club_contact_exports for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "Club admins read own contact exports" on club_contact_exports;
create policy "Club admins read own contact exports"
  on club_contact_exports for select
  using (is_club_member(club_id));

-- ─────────────────────────────────────────────────────────────
-- Fra ordre til kontakt, nå med annonser
--
-- Som i 077, pluss: en ordre med både e-post- og annonsekryss gir
-- annonsesamtykke (og et nytt ja etter en tilbaketrekking). En ordre med
-- bare e-postkryss rører ikke annonsesamtykket — å la være å krysse er ikke
-- å trekke seg. Annonsekryss uten e-postkryss ignoreres; checkout tillater
-- det ikke, og en kontakt finnes ikke uten e-postsamtykket.
--
-- Teksten må være lik `checkoutAdsOptInLabel` i lib/marketing/contacts.ts.
-- ─────────────────────────────────────────────────────────────
create or replace function sync_club_contact_from_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_club_name text;
  v_bought_at timestamptz;
  v_ads boolean;
begin
  if new.club_id is null or new.buyer_email is null then
    return new;
  end if;

  v_email := lower(btrim(new.buyer_email));
  if position('@' in v_email) < 2 then
    return new;
  end if;

  v_bought_at := coalesce(new.created_at, now());
  v_ads := coalesce(new.ads_opt_in, false);

  if new.marketing_opt_in then
    select name into v_club_name from clubs where id = new.club_id;

    insert into club_contacts (
      club_id, email, name, phone, source, consent_at, consent_text,
      consent_order_id, last_show_id, last_purchase_at,
      ads_consent_at, ads_consent_source, ads_consent_text, ads_consent_order_id
    ) values (
      new.club_id, v_email, nullif(btrim(coalesce(new.buyer_name, '')), ''), new.buyer_phone, 'purchase',
      coalesce(new.marketing_opt_in_at, v_bought_at),
      'Yes, send me emails from ' || coalesce(v_club_name, 'the organiser') || ' about upcoming shows.',
      new.id, new.show_id, v_bought_at,
      case when v_ads then coalesce(new.ads_opt_in_at, v_bought_at) end,
      case when v_ads then 'purchase' end,
      case when v_ads then
        'Show me relevant ads from ' || coalesce(v_club_name, 'the organiser') || ' on Facebook and Instagram.'
      end,
      case when v_ads then new.id end
    )
    on conflict (club_id, email) do update set
      source            = 'purchase',
      consent_at        = excluded.consent_at,
      consent_text      = excluded.consent_text,
      consent_order_id  = excluded.consent_order_id,
      consent_import_id = null,
      unsubscribed_at   = null,
      name              = coalesce(club_contacts.name, excluded.name),
      phone             = coalesce(club_contacts.phone, excluded.phone),
      last_show_id      = case when club_contacts.last_purchase_at is null
                                 or club_contacts.last_purchase_at <= excluded.last_purchase_at
                               then coalesce(excluded.last_show_id, club_contacts.last_show_id)
                               else club_contacts.last_show_id end,
      last_purchase_at  = greatest(club_contacts.last_purchase_at, excluded.last_purchase_at),
      ads_consent_at        = case when v_ads then excluded.ads_consent_at else club_contacts.ads_consent_at end,
      ads_consent_source    = case when v_ads then excluded.ads_consent_source else club_contacts.ads_consent_source end,
      ads_consent_text      = case when v_ads then excluded.ads_consent_text else club_contacts.ads_consent_text end,
      ads_consent_order_id  = case when v_ads then excluded.ads_consent_order_id else club_contacts.ads_consent_order_id end,
      ads_consent_import_id = case when v_ads then null else club_contacts.ads_consent_import_id end,
      ads_withdrawn_at      = case when v_ads then null else club_contacts.ads_withdrawn_at end;
  else
    update club_contacts
    set last_show_id = coalesce(new.show_id, last_show_id),
        last_purchase_at = v_bought_at
    where club_id = new.club_id
      and email = v_email
      and (last_purchase_at is null or last_purchase_at <= v_bought_at);
  end if;

  return new;
-- Triggeren kjører inne i complete_checkout_order. En feil her skal aldri
-- koste kjøperen billetten: da mister vi heller kontakten og logger det.
exception when others then
  raise warning 'sync_club_contact_from_order failed for order %: %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function sync_club_contact_from_order() from public, anon, authenticated;

-- Annonsekrysset settes med en egen oppdatering etter complete_checkout_order
-- (`recordAdsOptIn` i lib/checkout/ads-opt-in.ts), så betalings-RPC-en ikke
-- må defineres på nytt. Da kjører funksjonen en gang til for samme ordre;
-- e-postdelen gir samme resultat som første gang.
drop trigger if exists orders_sync_club_contact_ads on orders;
create trigger orders_sync_club_contact_ads
  after update of ads_opt_in on orders
  for each row
  when (new.ads_opt_in and not old.ads_opt_in and new.status = 'paid')
  execute function sync_club_contact_from_order();

-- ─────────────────────────────────────────────────────────────
-- Avmelding fra alt trekker annonsesamtykket
--
-- Avmeldingssiden, one-click-ruten og klubbens «Unsubscribe» setter alle
-- bare `unsubscribed_at`. Her, ett sted, følger annonsene med — og «Subscribe
-- again» gir dem ikke tilbake.
-- ─────────────────────────────────────────────────────────────
create or replace function club_contacts_withdraw_ads_on_unsubscribe()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.unsubscribed_at is not null
     and old.unsubscribed_at is null
     and new.ads_consent_at is not null
     and new.ads_withdrawn_at is null then
    new.ads_withdrawn_at := new.unsubscribed_at;
  end if;
  return new;
end;
$$;

revoke all on function club_contacts_withdraw_ads_on_unsubscribe() from public, anon, authenticated;

drop trigger if exists club_contacts_withdraw_ads on club_contacts;
create trigger club_contacts_withdraw_ads
  before update of unsubscribed_at on club_contacts
  for each row
  execute function club_contacts_withdraw_ads_on_unsubscribe();
