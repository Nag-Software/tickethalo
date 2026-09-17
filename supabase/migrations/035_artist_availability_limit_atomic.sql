-- ============================================================
-- Migration 035: Atomic max-3 artist availability enforcement
--   #15 The 028 trigger fired BEFORE INSERT only (UPDATEing an existing row's
--       date bypassed it) and the count-then-check was not serialized, so two
--       concurrent inserts could both pass and leave 4+ active dates.
--   #20 Same TOCTOU race from the app-level toggleAvailabilityAction.
--
-- Fix: take a per-artist advisory lock so the count-then-check is atomic, fire
-- on UPDATE too, and exclude the row being updated so re-saving an existing
-- future date does not falsely trip the cap.
-- ============================================================

create or replace function public.enforce_artist_availability_limit()
returns trigger
language plpgsql
as $$
declare
  active_count integer;
begin
  -- Serialize concurrent insert/update for the same artist so the count-then-check
  -- below is atomic (two parallel transactions could otherwise both read < 3).
  perform pg_advisory_xact_lock(hashtextextended(new.artist_id::text, 0));

  select count(*)
  into active_count
  from public.artist_availability
  where artist_id = new.artist_id
    and available_date >= current_date
    and id <> new.id;  -- exclude the row being updated; harmless on INSERT

  if active_count >= 3 then
    raise exception 'Artist can have at most 3 active availability dates';
  end if;

  return new;
end;
$$;

drop trigger if exists artist_availability_max_three on public.artist_availability;

create trigger artist_availability_max_three
  before insert or update of available_date, artist_id on public.artist_availability
  for each row
  execute function public.enforce_artist_availability_limit();
