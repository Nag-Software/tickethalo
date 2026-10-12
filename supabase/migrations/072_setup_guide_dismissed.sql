-- ============================================================
-- Migration 072: Oppstartsguiden kan legges bort
--
-- Nye klubber får en liten sjekkliste nede til høyre i klubbportalen:
-- klubbprofil, utbetaling, første show, publisering. Punktene sjekkes av
-- fra det som faktisk er gjort, så guiden trenger ingen egen tilstand —
-- bortsett fra at klubben kan legge den bort når alt er på plass. Det
-- lagres på klubben, ikke i nettleseren, så den forblir borte for alle
-- admins og på alle enheter.
-- ============================================================

alter table clubs
  add column if not exists setup_guide_dismissed_at timestamptz;

comment on column clubs.setup_guide_dismissed_at is
  'Når klubben la bort oppstartsguiden. Null = vises så lenge noe gjenstår.';
