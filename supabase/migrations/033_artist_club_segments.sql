-- ─────────────────────────────────────────────────────────────
-- Per-club artist nivå/segments
--
-- Comedians are segmented (Headliner, Konferansier, Klubbspot,
-- Stand-up, Open Mic) per club, because clubs evaluate the same
-- comedian differently. This replaces the visible 1–10 score.
-- `categories` overrides the artist's self-declared `artists.category`
-- for this club's booking; when null/empty the global value is used.
--
-- The numeric score columns (artist_club_scores.score,
-- club_booking_settings.quality_weight/min_bookable_score) are left in
-- place but no longer drive booking — the engine receives a neutral
-- constant score for every candidate (see BOOKING_NEUTRAL_SCORE).
-- ─────────────────────────────────────────────────────────────

ALTER TABLE artist_club_scores
  ADD COLUMN IF NOT EXISTS categories text[];
