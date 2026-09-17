-- ============================================================
-- Migrasjon 053 (fase 2, vakt): ingen publisering med ledige plasser
--
-- Publikum kjøper billett til en kveld med navn på. Et show som publiseres
-- halvfylt selger dårligere, og navnene som dukker opp etterpå rekker ikke
-- markedsføringen.
--
-- Koden har fjernet alle veiene dit, men `published` er statusen som åpner
-- billettsalget — den skal ikke kunne settes ved et uhell, heller ikke fra
-- en konsoll. Vakten står derfor i databasen.
--
-- Den gjelder bare *overgangen* til `published`. Faller en komiker fra
-- etterpå, blir showet stående publisert: billettene er solgt, og motoren
-- fyller plassen igjen.
--
-- Vil klubben kjøre med færre komikere, sletter bookeren plassen. Da er
-- lineupen full.
-- ============================================================

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

  -- Et show som allerede er publisert kan oppdateres fritt. Vakten er en
  -- sperre mot å *gå inn i* published, ikke mot å leve der.
  if tg_op = 'UPDATE' then
    if old.status = 'published' then
      return new;
    end if;
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

drop trigger if exists shows_full_lineup_before_publish on shows;

create trigger shows_full_lineup_before_publish
  before insert or update of status on shows
  for each row
  execute function enforce_full_lineup_before_publish();
