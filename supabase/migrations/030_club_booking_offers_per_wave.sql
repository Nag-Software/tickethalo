-- Configurable cascade wave size (how many simultaneous sent offers per requirement).
alter table club_booking_settings
  add column if not exists offers_per_wave integer not null default 1
  check (offers_per_wave >= 1 and offers_per_wave <= 10);

-- Wave size is enforced in application code; drop hard cap of 1 if present.
drop index if exists idx_booking_offers_one_sent_per_requirement;
