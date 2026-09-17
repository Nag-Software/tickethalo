-- ============================================================
-- Migrasjon 052 (fase 1, krymp): score kvalifiserer ikke lenger
--
-- `min_score` på plassen, og fallbacken som senket den med 1 og så 2, kom
-- fra en tid da bookeren satte scoren for hånd. Det gjør hen ikke lenger:
-- scoren er systemsatt, og etter fase 6 er den et snitt av vurderinger. En
-- terskel på en slik verdi stenger komikere ute fra show klubben gjerne
-- ville hatt dem på, uten at noen ser hvorfor.
--
-- Score prioriterer nå, og kvalifiserer aldri. Kravene som kvalifiserer —
-- rolle, energi, kjønn, ledig dag, ingen kollisjon — lempes ikke av noen
-- fallback, så `fallback_limit` har ikke noe igjen å gjøre.
--
-- `role_match_bonus` ga alle kandidatene på en plass det samme påslaget:
-- rollen er et krav, så ingen kandidat kunne mangle den. Den flyttet aldri
-- noen i køen.
--
-- `busy_penalty_per_booking` og `busy_window_days` erstattes av rotasjonen
-- i 051, som bare teller plasser i den samme klubben.
-- ============================================================

alter table show_requirements drop column if exists min_score;

alter table booking_scoring_config
  drop column if exists fallback_limit,
  drop column if exists busy_penalty_per_booking,
  drop column if exists busy_window_days,
  drop column if exists role_match_bonus;
