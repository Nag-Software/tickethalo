-- Enforce max 3 current/future availability dates per artist.

create or replace function public.enforce_artist_availability_limit()
returns trigger
language plpgsql
as $$
declare
  active_count integer;
begin
  select count(*)
  into active_count
  from public.artist_availability
  where artist_id = new.artist_id
    and available_date >= current_date;

  if active_count >= 3 then
    raise exception 'Artist can have at most 3 active availability dates';
  end if;

  return new;
end;
$$;

drop trigger if exists artist_availability_max_three on public.artist_availability;

create trigger artist_availability_max_three
  before insert on public.artist_availability
  for each row
  execute function public.enforce_artist_availability_limit();
