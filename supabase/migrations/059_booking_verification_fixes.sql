-- ============================================================
-- Migrasjon 059: tre ting granskingen fant
--
--  1. **Vranglås mellom to ja på samme show.** `accept_booking_offer`
--     låste først plassen tilbudet gjaldt, og deretter *alle* plassene på
--     showet i planens rekkefølge. To komikere som svarte ja samtidig på
--     hver sin plass, tok dermed låsene i motsatt rekkefølge: den ene holdt
--     R2 og ville ha R1, den andre holdt R1 og ville ha R2. Postgres
--     avbryter den ene med 40P01, og komikeren får en feilside på det
--     viktigste trykket i hele produktet.
--
--     Løkken låser ikke lenger. Den bare teller om alle plassene er fylt,
--     og et tall som er ett sekund gammelt er ufarlig: publiseringen
--     sjekker på nytt, og vakten i 053 er den som faktisk stopper et show
--     med ledige plasser. Rekkefølgen står likevel på `sr.id`, så to
--     kjøringer alltid går samme vei.
--
--  2. **Vakten gjorde det umulig å sette inn et publisert show.** Den talte
--     `show_requirements` for raden — i en `before insert`-trigger, der
--     showet ennå ikke finnes. Svaret var alltid null, så enhver innsetting
--     med `status = 'published'` ble avvist. Ingenting i appen gjør det, men
--     en gjenoppretting eller en datarettelse ville stått fast. En ny rad
--     kan uansett ikke ha plasser, så sjekken hører bare hjemme på oppdatering.
--
--  3. **Komikeren kunne skrive utilgjengelige datoer utenom appen.** RLS ga
--     komikerens egen nøkkel `for all` på tabellen. Radene var riktig
--     avgrenset til hen selv, men de to reglene som gjør funksjonen til noe
--     mer enn en liste — at en bekreftet kveld ikke kan markeres, og at å
--     markere en kveld med et ubesvart tilbud også takker nei — finnes bare
--     i serverhandlingen. Med direkte skrivetilgang var de valgfrie.
--     Appen skriver med tjenestenøkkelen og merker ikke forskjellen.
-- ============================================================

-- ── 1. Ingen lås i tellingen til slutt ───────────────────────────────────
create or replace function accept_booking_offer(p_token text)
returns table (
  result text,
  offer_id uuid,
  show_id uuid,
  artist_id uuid,
  show_requirement_id uuid,
  confirmed_spot_id uuid,
  should_notify boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer booking_offers%rowtype;
  v_quantity integer;
  v_filled integer;
  v_spot_id uuid;
  v_requirement record;
  v_all_filled boolean := true;
  v_show_date date;
  v_show_start time;
  v_window_hours numeric;
  v_conflicts integer;
begin
  select * into v_offer
  from booking_offers bo
  where bo.token = p_token
  for update;

  if not found then
    raise exception 'Offer not found' using errcode = 'P0002';
  end if;

  if v_offer.status = 'accepted' then
    select cs.id into v_spot_id
    from confirmed_spots cs
    where cs.booking_offer_id = v_offer.id
      and cs.status in ('confirmed', 'completed', 'paid')
    limit 1;

    return query select 'accepted'::text, v_offer.id, v_offer.show_id, v_offer.artist_id,
      v_offer.show_requirement_id, v_spot_id, false;
    return;
  end if;

  if v_offer.status <> 'sent' then
    return query select v_offer.status, v_offer.id, v_offer.show_id, v_offer.artist_id,
      v_offer.show_requirement_id, null::uuid, false;
    return;
  end if;

  if v_offer.expires_at is not null and v_offer.expires_at < now() then
    update booking_offers bo
    set status = 'expired', responded_at = now()
    where bo.id = v_offer.id;

    return query select 'expired'::text, v_offer.id, v_offer.show_id, v_offer.artist_id,
      v_offer.show_requirement_id, null::uuid, false;
    return;
  end if;

  -- Låsen står på komikeren alene, ikke på show + komiker som før. To ja fra
  -- den samme komikeren på to forskjellige show kunne ellers kjøre side om
  -- side, og begge se en tom kalender i kollisjonssjekken under.
  perform pg_advisory_xact_lock(hashtextextended(v_offer.artist_id::text, 0));

  select cs.id into v_spot_id
  from confirmed_spots cs
  where cs.show_id = v_offer.show_id
    and cs.artist_id = v_offer.artist_id
    and cs.status in ('confirmed', 'completed', 'paid')
  limit 1;

  if v_spot_id is not null then
    update booking_offers bo
    set status = 'cancelled', responded_at = now()
    where bo.id = v_offer.id;

    update booking_offers bo
    set status = 'cancelled', responded_at = now()
    where bo.show_id = v_offer.show_id
      and bo.artist_id = v_offer.artist_id
      and bo.status = 'sent';

    return query select 'already_booked'::text, v_offer.id, v_offer.show_id, v_offer.artist_id,
      v_offer.show_requirement_id, v_spot_id, true;
    return;
  end if;

  -- ── Kollisjon med en annen booking samme kveld ────────────────────────
  --
  -- Komikeren har sagt ja her, men har allerede en bekreftet plass på et
  -- show som starter for nær. Tilbudet settes `declined`: hen kan ikke ta
  -- plassen, og motoren skal ikke sende den samme kvelden på nytt. Setet
  -- blir stående ledig for andre.
  select s.date, s.start_time into v_show_date, v_show_start
  from shows s
  where s.id = v_offer.show_id;

  select coalesce(bsc.conflict_window_hours, 3) into v_window_hours
  from booking_scoring_config bsc
  where bsc.id = 'default';

  v_window_hours := coalesce(v_window_hours, 3);

  select count(*) into v_conflicts
  from confirmed_spots cs
  join shows s2 on s2.id = cs.show_id
  where cs.artist_id = v_offer.artist_id
    and cs.status in ('confirmed', 'completed', 'paid')
    and cs.show_id <> v_offer.show_id
    and s2.deleted_at is null
    and s2.date = v_show_date
    and (
      s2.start_time is null
      or v_show_start is null
      or abs(extract(epoch from (s2.start_time - v_show_start))) < v_window_hours * 3600
    );

  if v_conflicts > 0 then
    update booking_offers bo
    set status = 'declined', responded_at = now()
    where bo.id = v_offer.id;

    return query select 'conflict'::text, v_offer.id, v_offer.show_id, v_offer.artist_id,
      v_offer.show_requirement_id, null::uuid, true;
    return;
  end if;

  select sr.quantity into v_quantity
  from show_requirements sr
  where sr.id = v_offer.show_requirement_id
  for update;

  if not found then
    raise exception 'Show requirement not found' using errcode = 'P0002';
  end if;

  select count(*) into v_filled
  from confirmed_spots cs
  where cs.show_requirement_id = v_offer.show_requirement_id
    and cs.status in ('confirmed', 'completed', 'paid');

  if v_filled >= v_quantity then
    update booking_offers bo
    set status = 'filled_by_other', responded_at = now()
    where bo.id = v_offer.id;

    return query select 'filled_by_other'::text, v_offer.id, v_offer.show_id, v_offer.artist_id,
      v_offer.show_requirement_id, null::uuid, true;
    return;
  end if;

  insert into confirmed_spots (
    show_id,
    artist_id,
    show_requirement_id,
    booking_offer_id,
    fee_amount,
    currency,
    status,
    confirmed_at
  ) values (
    v_offer.show_id,
    v_offer.artist_id,
    v_offer.show_requirement_id,
    v_offer.id,
    v_offer.fee_amount,
    v_offer.currency,
    'confirmed',
    now()
  )
  returning id into v_spot_id;

  update booking_offers bo
  set status = 'accepted', responded_at = now()
  where bo.id = v_offer.id;

  update booking_offers bo
  set status = 'cancelled', responded_at = now()
  where bo.show_id = v_offer.show_id
    and bo.artist_id = v_offer.artist_id
    and bo.status = 'sent'
    and bo.id <> v_offer.id;

  select count(*) into v_filled
  from confirmed_spots cs
  where cs.show_requirement_id = v_offer.show_requirement_id
    and cs.status in ('confirmed', 'completed', 'paid');

  if v_filled >= v_quantity then
    update booking_offers bo
    set status = 'filled_by_other', responded_at = now()
    where bo.show_requirement_id = v_offer.show_requirement_id
      and bo.status = 'sent'
      and bo.id <> v_offer.id;
  end if;

  for v_requirement in
    select sr.id, sr.quantity
    from show_requirements sr
    where sr.show_id = v_offer.show_id
    order by sr.id
  loop
    select count(*) into v_filled
    from confirmed_spots cs
    where cs.show_requirement_id = v_requirement.id
      and cs.status in ('confirmed', 'completed', 'paid');

    if v_filled < v_requirement.quantity then
      v_all_filled := false;
      exit;
    end if;
  end loop;

  if v_all_filled then
    update shows s
    set status = 'fullbooked'
    where s.id = v_offer.show_id
      and s.status in ('draft', 'booking');

    insert into marketing_tasks (show_id, task_key, label, is_completed)
    select task_rows.task_show_id, task_rows.task_key, task_rows.task_label, task_rows.task_completed
    from (values
      (v_offer.show_id, 'publish_event_page', 'Publiser event-side', false),
      (v_offer.show_id, 'activate_ticket_sales', 'Aktiver billettsalg', false),
      (v_offer.show_id, 'upload_poster', 'Last opp plakat', false),
      (v_offer.show_id, 'create_facebook_event', 'Opprett Facebook-event', false),
      (v_offer.show_id, 'share_facebook_groups', 'Del i Facebook-grupper', false),
      (v_offer.show_id, 'send_calendar_partners', 'Send til kalenderpartnere', false),
      (v_offer.show_id, 'schedule_email', 'Planlegg e-postkampanje', false)
    ) as task_rows(task_show_id, task_key, task_label, task_completed)
    where not exists (
      select 1
      from marketing_tasks mt
      where mt.show_id = task_rows.task_show_id
        and mt.task_key = task_rows.task_key
    );
  end if;

  return query select 'accepted'::text, v_offer.id, v_offer.show_id, v_offer.artist_id,
    v_offer.show_requirement_id, v_spot_id, true;
end;
$$;

-- ── 2. Vakten gjelder bare overgangen, og bare på oppdatering ────────────
create or replace function enforce_full_lineup_before_publish()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_spots integer;
  v_open integer;
begin
  if new.status <> 'published' then
    return new;
  end if;

  -- En rad som settes inn kan ikke ha plasser ennå: de peker på showet, og
  -- showet finnes ikke før innsettingen er ferdig. Sjekken her ville derfor
  -- alltid slått ut, uansett hva som ble satt inn.
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Et show som allerede er publisert kan oppdateres fritt. Vakten er en
  -- sperre mot å *gå inn i* published, ikke mot å leve der. Faller en
  -- komiker fra etterpå, blir showet stående — billettene er solgt.
  if old.status = 'published' then
    return new;
  end if;

  select count(*) into v_spots
  from show_requirements sr
  where sr.show_id = new.id;

  if v_spots = 0 then
    raise exception 'Showet har ingen lineup-plasser og kan ikke publiseres.'
      using errcode = 'P0001';
  end if;

  select count(*) into v_open
  from show_requirements sr
  where sr.show_id = new.id
    and sr.quantity > (
      select count(*)
      from confirmed_spots cs
      where cs.show_requirement_id = sr.id
        and cs.status in ('confirmed', 'completed', 'paid')
    );

  if v_open > 0 then
    raise exception 'Lineupen har % ledige plasser. Fyll dem, eller slett plassen, før showet publiseres.', v_open
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- ── 3. Komikeren leser sine egne datoer, og skriver gjennom appen ────────
drop policy if exists "Artist manages own unavailable dates" on artist_unavailable_dates;

create policy "Artist reads own unavailable dates"
  on artist_unavailable_dates for select
  using (artist_id = my_artist_id());
