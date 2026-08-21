-- ============================================================
-- Migration 031: show_ticket_counts
--
-- Eventlistene (forsiden, /events, klubbsidene) trengte antall
-- solgte billetter per show, og hentet det med én count-runde
-- *per show* — tjue viste show ga tjue kall. Denne visningen
-- gjør det til ett kall med et lite svar, og lar Postgres
-- gjøre tellingen den er god på.
--
-- `security_invoker` slår på, slik at RLS på tickets fortsatt
-- gjelder for den som spør. Serverkoden bruker service-rollen
-- og ser alt, som før.
-- ============================================================

create or replace view show_ticket_counts
  with (security_invoker = true)
as
select
  show_id,
  count(*)::int as sold_tickets
from tickets
where status in ('valid', 'used')
group by show_id;

comment on view show_ticket_counts is
  'Solgte billetter per show (status valid/used). Erstatter én count-spørring per show i eventlistene.';
