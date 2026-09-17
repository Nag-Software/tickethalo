-- ─────────────────────────────────────────────────────────────
-- Per-club artist approval and score
-- Clubs independently approve/reject artists and optionally
-- assign a quality score (1–10) based on submitted video.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artist_club_scores (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  artist_id   uuid        NOT NULL REFERENCES artists(id)  ON DELETE CASCADE,
  club_id     uuid        NOT NULL REFERENCES clubs(id)    ON DELETE CASCADE,
  approved    boolean     NOT NULL DEFAULT false,
  score       integer     CHECK (score IS NULL OR (score >= 1 AND score <= 10)),
  notes       text,
  reviewed_at timestamptz,
  created_at  timestamptz DEFAULT now() NOT NULL,
  updated_at  timestamptz DEFAULT now() NOT NULL,
  UNIQUE (artist_id, club_id)
);

-- ─────────────────────────────────────────────────────────────
-- Post-show performance review per confirmed booking spot
-- Admin gives a score (1–10) after each show, stored per spot.
-- The average of these can guide the global admin_score.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artist_performance_reviews (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  confirmed_spot_id uuid       NOT NULL REFERENCES confirmed_spots(id) ON DELETE CASCADE UNIQUE,
  artist_id        uuid        NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  show_id          uuid        NOT NULL REFERENCES shows(id)  ON DELETE CASCADE,
  club_id          uuid        REFERENCES clubs(id)           ON DELETE SET NULL,
  score            integer     NOT NULL CHECK (score >= 1 AND score <= 10),
  notes            text,
  created_at       timestamptz DEFAULT now() NOT NULL,
  updated_at       timestamptz DEFAULT now() NOT NULL
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_artist_club_scores_artist_id   ON artist_club_scores (artist_id);
CREATE INDEX IF NOT EXISTS idx_artist_club_scores_club_id     ON artist_club_scores (club_id);
CREATE INDEX IF NOT EXISTS idx_perf_reviews_artist_id         ON artist_performance_reviews (artist_id);
CREATE INDEX IF NOT EXISTS idx_perf_reviews_show_id           ON artist_performance_reviews (show_id);
CREATE INDEX IF NOT EXISTS idx_perf_reviews_club_id           ON artist_performance_reviews (club_id);
