-- ============================================================
-- Migrasjon 051 (fase 1, utvid): rotasjon, kollisjon og ny accept-funksjon
--
-- Tre ting:
--
--  1. Nye innstillinger i `booking_scoring_config`. Straffen for å være
--     travel gjaldt før alle klubber på plattformen — en komiker som jobbet
--     mye andre steder havnet bakerst her. Den erstattes av en rotasjon
--     innenfor *klubben*: ett scorepoeng per plass komikeren allerede har
--     hos samme klubb i vinduet rundt showdatoen.
--
--  2. `conflict_window_hours`: to show samme kveld er lov, men ikke når de
--     starter nærmere hverandre enn dette. Mangler ett av dem starttid,
--     gjelder hele dagen.
--
--  3. `accept_booking_offer` avviser et ja som ville dobbeltbooket
--     komikeren, og svarer `conflict`. Den gamle låste på show + komiker,
--     så to ja på to forskjellige show kunne gå gjennom samtidig. Den nye
--     låser på komikeren alene.
--
-- Funksjonen er 049 ordrett, med kollisjonssjekken lagt inn etter låsen og
-- før plassen telles.
-- ============================================================

alter table booking_scoring_config
  add column if not exists rotation_penalty numeric not null default 10,
  add column if not exists rotation_window_days integer not null default 30,
  add column if not exists conflict_window_hours numeric not null default 3;

comment on column booking_scoring_config.rotation_penalty is
  'Poeng som trekkes per bekreftet plass komikeren har i samme klubb innenfor vinduet. 10 = ett scorepoeng.';
comment on column booking_scoring_config.rotation_window_days is
  'Antall dager før og etter showdatoen rotasjonsstraffen ser etter andre plasser i klubben.';
comment on column booking_scoring_config.conflict_window_hours is
  'To show samme dato kolliderer når starttidene er nærmere hverandre enn dette. Mangler starttid, gjelder hele dagen.';

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
    for update
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
