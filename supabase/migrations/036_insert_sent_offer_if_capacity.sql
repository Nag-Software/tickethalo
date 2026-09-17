-- ============================================================
-- Migration 036: Atomic per-wave offer insertion  (#8)
--   offers_per_wave was enforced by a non-atomic count-then-insert in app code.
--   Migration 029's unique index was dropped in 030 (because offers_per_wave can
--   be >1), leaving no DB backstop, so concurrent auto-booking runs (decline +
--   cron + admin) could over-offer a single slot.
--
-- This RPC takes a per-requirement advisory lock, re-counts active sent offers,
-- and only inserts when still below the wave cap — making the cap atomic without
-- a unique index. Called from bookShow() and sendOffersForReopenedRequirement().
-- ============================================================

create or replace function insert_sent_offer_if_capacity(
  p_show_id uuid,
  p_artist_id uuid,
  p_requirement_id uuid,
  p_offers_per_wave integer,
  p_expires_at timestamptz,
  p_fee_amount integer default null,
  p_currency text default 'NOK'
)
returns table (token text, inserted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active integer;
  v_token text;
begin
  -- Serialize concurrent runs for the same requirement so the count+insert is atomic.
  perform pg_advisory_xact_lock(hashtextextended(p_requirement_id::text, 0));

  select count(*) into v_active
  from booking_offers
  where show_requirement_id = p_requirement_id
    and status = 'sent';

  if v_active >= p_offers_per_wave then
    return query select null::text, false;
    return;
  end if;

  insert into booking_offers (
    show_id, artist_id, show_requirement_id, status, sent_at, expires_at, fee_amount, currency
  ) values (
    p_show_id, p_artist_id, p_requirement_id, 'sent', now(), p_expires_at,
    p_fee_amount, coalesce(p_currency, 'NOK')
  )
  returning booking_offers.token into v_token;

  return query select v_token, true;
end;
$$;
