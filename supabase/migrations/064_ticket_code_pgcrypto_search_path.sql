-- ============================================================
-- Migration 064: generate_ticket_code finner ikke gen_random_bytes
--
-- Første betalte kjøp i produksjon ga ingen billett:
--   «function gen_random_bytes(integer) does not exist»
--
-- Migrasjon 037 låste funksjonen til `search_path = public`. På Supabase
-- ligger pgcrypto i skjemaet `extensions`, ikke `public`, så
-- `gen_random_bytes` ble usynlig for funksjonen. Den er standardverdien for
-- `tickets.ticket_code`, og dermed feilet hver `complete_checkout_order` —
-- kjøperen betalte, men fikk verken billett eller e-post.
--
-- Kolonnestandardene som bruker `gen_random_bytes` direkte (tilbudstoken,
-- fakturatoken) er ikke berørt: de ble bundet til funksjonen da de ble laget.
-- Bare funksjonskropper slås opp på nytt ved hvert kall.
--
-- `extensions` legges til i søkestien. Et skjema som ikke finnes, hoppes
-- stille over, så dette virker også der pgcrypto ligger i `public`.
-- ============================================================

alter function generate_ticket_code(integer)
  set search_path = public, extensions;
