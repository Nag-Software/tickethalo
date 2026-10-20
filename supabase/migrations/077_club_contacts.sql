-- ============================================================
-- Migrasjon 077: klubbens e-postliste
--
-- Publikum som har sagt ja til e-post fra én klubb. Listen er klubbens, ikke
-- Tickethalos: klubben er behandlingsansvarlig, vi er databehandler. Derfor
-- en egen tabell per klubb og ikke `customers` (global, bare superadmin) eller
-- `city_subscribers` (plattformens byliste, uten klubb).
--
-- Tre veier inn:
--   purchase — kjøperen krysset av i checkout (`orders.marketing_opt_in`, 073).
--              Fylles av triggeren under, både for Stripe- og gratisordrer,
--              uten at `complete_checkout_order` eller koden som er deployet
--              trenger å vite om det.
--   import   — klubben lastet opp en CSV og bekreftet at folkene har sagt ja.
--              Bekreftelsen står på `club_contact_imports`.
--   signup   — reservert til et påmeldingsskjema på klubbsiden. Finnes ikke ennå.
--
-- Samtykket må kunne vises (GDPR art. 7(1)): hver kontakt har tidspunktet,
-- teksten personen sa ja til og ordren eller importen det kom fra.
--
-- En avmeldt kontakt blir stående med `unsubscribed_at` — raden er det som
-- hindrer at neste import melder hen på igjen. Bare et nytt, aktivt ja ved et
-- kjøp nullstiller den. Sletting (innsynskrav) fjerner raden helt.
-- ============================================================

create table if not exists club_contact_imports (
  id                uuid primary key default gen_random_uuid(),
  club_id           uuid not null references clubs(id) on delete cascade,
  imported_by       uuid references profiles(id) on delete set null,
  file_name         text,
  consent_statement text not null,
  rows_total        integer not null default 0,
  added             integer not null default 0,
  updated           integer not null default 0,
  skipped           integer not null default 0,
  created_at        timestamptz not null default now()
);

comment on table club_contact_imports is
  'Én rad per CSV-import til klubbens e-postliste. consent_statement er teksten klubben krysset av for.';

create index if not exists idx_club_contact_imports_club on club_contact_imports (club_id, created_at desc);

create table if not exists club_contacts (
  id                uuid primary key default gen_random_uuid(),
  club_id           uuid not null references clubs(id) on delete cascade,
  -- Alltid små bokstaver, så én person er én rad uansett hvordan adressen ble skrevet.
  email             text not null check (email = lower(email) and position('@' in email) > 1),
  name              text,
  phone             text,
  source            text not null check (source in ('purchase', 'import', 'signup')),
  consent_at        timestamptz not null,
  consent_text      text,
  consent_order_id  uuid references orders(id) on delete set null,
  consent_import_id uuid references club_contact_imports(id) on delete set null,
  last_show_id      uuid references shows(id) on delete set null,
  last_purchase_at  timestamptz,
  unsubscribed_at   timestamptz,
  -- 64 hex-tegn. Står i avmeldingslenken; gjetter man den, kan man bare melde av.
  unsubscribe_token text not null unique
    default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (club_id, email)
);

comment on table club_contacts is
  'Klubbens e-postliste. Kan få e-post: unsubscribed_at is null. Se migrasjon 077.';
comment on column club_contacts.source is
  'Hvor samtykket kom fra: purchase (avkrysning i checkout), import (CSV med klubbens bekreftelse), signup (reservert).';
comment on column club_contacts.consent_text is
  'Ordlyden personen sa ja til, eller klubbens bekreftelse ved import.';
comment on column club_contacts.last_show_id is
  'Siste show personen kjøpte billett til i klubben, med eller uten avkrysning.';

create index if not exists idx_club_contacts_club_created on club_contacts (club_id, created_at desc);

drop trigger if exists club_contacts_updated_at on club_contacts;
create trigger club_contacts_updated_at
  before update on club_contacts
  for each row execute function update_updated_at();

-- ─────────────────────────────────────────────────────────────
-- Fra ordre til kontakt
--
-- En betalt ordre med avkrysning er et nytt samtykke: kontakten opprettes,
-- eller får nytt samtykke og meldes på igjen om hen hadde meldt seg av.
-- Navn og telefon fylles bare der de mangler — det klubben har skrevet inn
-- selv, overskrives ikke.
--
-- En betalt ordre uten avkrysning gir ingen kontakt, men flytter «siste show»
-- for en som allerede står på lista.
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
begin
  if new.club_id is null or new.buyer_email is null then
    return new;
  end if;

  v_email := lower(btrim(new.buyer_email));
  if position('@' in v_email) < 2 then
    return new;
  end if;

  v_bought_at := coalesce(new.created_at, now());

  if new.marketing_opt_in then
    select name into v_club_name from clubs where id = new.club_id;

    insert into club_contacts (
      club_id, email, name, phone, source, consent_at, consent_text,
      consent_order_id, last_show_id, last_purchase_at
    ) values (
      new.club_id, v_email, nullif(btrim(coalesce(new.buyer_name, '')), ''), new.buyer_phone, 'purchase',
      coalesce(new.marketing_opt_in_at, v_bought_at),
      'Yes, send me emails from ' || coalesce(v_club_name, 'the organiser') || ' about upcoming shows.',
      new.id, new.show_id, v_bought_at
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
      last_purchase_at  = greatest(club_contacts.last_purchase_at, excluded.last_purchase_at);
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

-- Ordren settes inn som `paid` av complete_checkout_order. Oppdateringen er
-- for en ordre som blir betalt senere; refusjon og disputt (status bort fra
-- `paid`) rører ikke lista.
drop trigger if exists orders_sync_club_contact_insert on orders;
create trigger orders_sync_club_contact_insert
  after insert on orders
  for each row
  when (new.status = 'paid')
  execute function sync_club_contact_from_order();

drop trigger if exists orders_sync_club_contact_paid on orders;
create trigger orders_sync_club_contact_paid
  after update of status on orders
  for each row
  when (new.status = 'paid' and old.status is distinct from 'paid')
  execute function sync_club_contact_from_order();

-- ─────────────────────────────────────────────────────────────
-- Backfill: ordrer med avkrysning fra før migrasjonen.
--
-- Også refunderte: samtykket ble gitt da ordren var betalt, og en refusjon
-- er ikke en avmelding. Avkrysningen den gang sa ikke klubbens navn, så det
-- er den ordlyden som lagres.
-- ─────────────────────────────────────────────────────────────
insert into club_contacts (
  club_id, email, name, phone, source, consent_at, consent_text, consent_order_id
)
select distinct on (o.club_id, lower(btrim(o.buyer_email)))
  o.club_id,
  lower(btrim(o.buyer_email)),
  nullif(btrim(coalesce(o.buyer_name, '')), ''),
  o.buyer_phone,
  'purchase',
  coalesce(o.marketing_opt_in_at, o.created_at),
  'Yes, I want to receive emails so that I don’t miss upcoming shows.',
  o.id
from orders o
where o.marketing_opt_in
  and o.status in ('paid', 'refunded')
  and o.club_id is not null
  and position('@' in btrim(coalesce(o.buyer_email, ''))) > 1
order by o.club_id, lower(btrim(o.buyer_email)), o.created_at desc
on conflict (club_id, email) do nothing;

update club_contacts c
set last_show_id = latest.show_id,
    last_purchase_at = latest.created_at
from (
  select distinct on (o.club_id, lower(btrim(o.buyer_email)))
    o.club_id, lower(btrim(o.buyer_email)) as email, o.show_id, o.created_at
  from orders o
  where o.status in ('paid', 'refunded')
    and o.club_id is not null
    and o.buyer_email is not null
  order by o.club_id, lower(btrim(o.buyer_email)), o.created_at desc
) latest
where latest.club_id = c.club_id
  and latest.email = c.email
  and c.last_purchase_at is null;

-- ─────────────────────────────────────────────────────────────
-- Tilgang: appen leser med service role. Policyene er for direkte klientkall.
-- ─────────────────────────────────────────────────────────────
alter table club_contacts enable row level security;
alter table club_contact_imports enable row level security;

drop policy if exists "Superadmin manage club contacts" on club_contacts;
create policy "Superadmin manage club contacts"
  on club_contacts for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "Club admins manage own contacts" on club_contacts;
create policy "Club admins manage own contacts"
  on club_contacts for all
  using (is_club_member(club_id)) with check (is_club_member(club_id));

drop policy if exists "Superadmin manage contact imports" on club_contact_imports;
create policy "Superadmin manage contact imports"
  on club_contact_imports for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "Club admins read own contact imports" on club_contact_imports;
create policy "Club admins read own contact imports"
  on club_contact_imports for select
  using (is_club_member(club_id));
