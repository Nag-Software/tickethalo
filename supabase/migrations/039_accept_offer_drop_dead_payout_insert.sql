-- ============================================================
-- Migration 039: remove the dead artist_payouts insert from accept_booking_offer
--   artist_payouts was dropped in migration 013 ("payouts tracked in Stripe
--   instead"), but accept_booking_offer (007/031/037) still ran
--   `insert into artist_payouts ...` for fee-bearing offers. plpgsql binds
--   embedded SQL lazily, so the function CREATED fine, but accepting a fixed-fee
--   offer threw `relation "artist_payouts" does not exist` at runtime, blocking
--   the accept. Fixed-compensation offers carry fee_amount, so this is a live path.
--
-- This is migration 037's function verbatim, minus the artist_payouts insert.
-- ============================================================
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

  perform pg_advisory_xact_lock(hashtextextended(v_offer.show_id::text || ':' || v_offer.artist_id::text, 0));

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

  -- (artist_payouts insert removed — table dropped in migration 013; the fee is
  --  recorded on confirmed_spots.fee_amount above and reconciled via Stripe.)

  select count(*) into v_filled
  from confirmed_spots cs
  where cs.show_requirement_id = v_offer.show_requirement_id
    and cs.status in ('confirmed', 'completed', 'paid');

  if v_filled >= v_quantity then
    update booking_offers bo
    set status = 'cancelled', responded_at = now()
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
