-- Enforce cascade booking: at most one active sent offer per requirement.
-- Step 1: cancel duplicate sent offers (keep oldest per requirement).
with ranked as (
  select
    id,
    row_number() over (
      partition by show_requirement_id
      order by sent_at asc nulls last, created_at asc
    ) as rn
  from booking_offers
  where status = 'sent'
    and show_requirement_id is not null
)
update booking_offers bo
set
  status = 'cancelled',
  responded_at = now()
from ranked r
where bo.id = r.id
  and r.rn > 1;

-- Step 2: unique partial index (safe after dedupe).
create unique index if not exists idx_booking_offers_one_sent_per_requirement
  on booking_offers (show_requirement_id)
  where status = 'sent' and show_requirement_id is not null;
