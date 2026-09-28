-- ============================================================
-- Migration 066: orders.ticket_email_sent_at
--
-- Billett-e-posten ble bare sendt av den som opprettet ordren (webhooken
-- eller suksesssiden, den som kom først). Feilet sendingen der, fantes det
-- ingen vei til et nytt forsøk: neste kall fikk «duplicate» fra
-- complete_checkout_order og sendte aldri, og suksesssiden sa likevel at
-- billetten «allerede er sendt».
--
-- Kolonnen sier om e-posten faktisk har gått. Er den tom på en ordre med
-- billetter, sender finalize e-posten uansett hvem som spør — og webhooken
-- svarer 500 så Stripe prøver igjen når den feiler.
--
-- Ordrer fra før kolonnen fantes får tidsstempelet satt: de har fått
-- e-posten sin på den gamle måten, og skal ikke få den én gang til.
-- ============================================================

alter table orders
  add column if not exists ticket_email_sent_at timestamptz;

comment on column orders.ticket_email_sent_at is
  'Når billett-e-posten gikk ut. Tom på en ordre med billetter betyr at den skal sendes (på nytt).';

update orders o
set ticket_email_sent_at = o.created_at
where o.ticket_email_sent_at is null
  and exists (select 1 from tickets t where t.order_id = o.id);
