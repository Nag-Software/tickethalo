-- ============================================================
-- Migration 037: Kortere billettkoder
--
-- Koden var 32 heksadesimaler («9f2a7c1e…»). Den fungerer for en
-- QR-kode, men er ubrukelig for et menneske: skal noen lese den
-- opp i døra fordi telefonen er tom for strøm, må den kunne
-- skrives inn uten feil.
--
-- Ny kode er åtte tegn fra et alfabet uten I, L, O og U — tegnene
-- som forveksles med 1, 0 og hverandre når de leses høyt eller
-- skrives for hånd. 32^8 ≈ 1,1 billioner kombinasjoner, mot noen
-- hundre gyldige koder per show.
--
-- Gamle koder står urørt: de er trykket i e-poster folk allerede
-- har fått, og unikhetskravet gjelder på tvers uansett.
-- ============================================================

create or replace function generate_ticket_code(p_length integer default 8)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Crockford-inspirert: ingen I, L, O eller U.
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  result text;
  position integer;
begin
  loop
    result := '';

    for position in 1..greatest(p_length, 4) loop
      -- 256 er delelig med 32, så modulo gir jevn fordeling uten skjevhet.
      result := result || substr(alphabet, (get_byte(gen_random_bytes(1), 0) % 32) + 1, 1);
    end loop;

    exit when not exists (select 1 from tickets t where t.ticket_code = result);
  end loop;

  return result;
end;
$$;

comment on function generate_ticket_code is
  'Åtte tegn fra et alfabet uten I/L/O/U, unik mot tickets. Kort nok til '
  'å leses opp i døra, og entydig nok til å skrives ned riktig.';

alter table tickets
  alter column ticket_code set default generate_ticket_code();

comment on column tickets.ticket_code is
  'Billettkoden. Åtte tegn fra migrasjon 037; eldre billetter har 32 '
  'heksadesimaler. Vises gruppert som XXXX-XXXX, lagres uten skilletegn.';
