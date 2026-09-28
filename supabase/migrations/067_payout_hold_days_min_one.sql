-- ============================================================
-- Migration 067: payout_hold_days må være minst 1
--
-- Frigjøringen regner «norsk dato minus payout_hold_days» og tar med show
-- med dato til og med det. Med 0 dager ble et show som spilles i kveld
-- frigitt av morgenkjøringen — før det var spilt. En avlysning samme dag
-- ville da refundert mot en tømt konto, som Tickethalo hefter for.
-- ============================================================

update clubs set payout_hold_days = 1 where payout_hold_days < 1;

alter table clubs
  drop constraint if exists clubs_payout_hold_days_check;

alter table clubs
  add constraint clubs_payout_hold_days_check
    check (payout_hold_days between 1 and 90);
