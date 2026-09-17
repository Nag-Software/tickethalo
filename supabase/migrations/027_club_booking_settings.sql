-- Per-club booking prioritization settings (democratic fairness multipliers)

CREATE TABLE IF NOT EXISTS club_booking_settings (
  club_id                      uuid PRIMARY KEY REFERENCES clubs(id) ON DELETE CASCADE,
  fairness_window_months       integer NOT NULL DEFAULT 12 CHECK (fairness_window_months >= 1 AND fairness_window_months <= 60),
  fairness_multiplier_0        numeric NOT NULL DEFAULT 1.0 CHECK (fairness_multiplier_0 > 0 AND fairness_multiplier_0 <= 1),
  fairness_multiplier_1        numeric NOT NULL DEFAULT 0.7 CHECK (fairness_multiplier_1 > 0 AND fairness_multiplier_1 <= 1),
  fairness_multiplier_2        numeric NOT NULL DEFAULT 0.5 CHECK (fairness_multiplier_2 > 0 AND fairness_multiplier_2 <= 1),
  fairness_multiplier_3        numeric NOT NULL DEFAULT 0.3 CHECK (fairness_multiplier_3 > 0 AND fairness_multiplier_3 <= 1),
  fairness_multiplier_4_plus   numeric NOT NULL DEFAULT 0.2 CHECK (fairness_multiplier_4_plus > 0 AND fairness_multiplier_4_plus <= 1),
  consecutive_event_multiplier numeric NOT NULL DEFAULT 0.1 CHECK (consecutive_event_multiplier > 0 AND consecutive_event_multiplier <= 1),
  quality_weight               numeric NOT NULL DEFAULT 100,
  availability_bonus           numeric NOT NULL DEFAULT 30,
  role_match_bonus             numeric NOT NULL DEFAULT 15,
  offers_per_slot              integer NOT NULL DEFAULT 10 CHECK (offers_per_slot >= 1),
  fallback_limit               integer NOT NULL DEFAULT 5 CHECK (fallback_limit >= 0),
  min_bookable_score           integer NOT NULL DEFAULT 6 CHECK (min_bookable_score >= 1 AND min_bookable_score <= 10),
  updated_at                   timestamptz NOT NULL DEFAULT NOW()
);

-- Seed one row per existing club from global booking_scoring_config defaults
INSERT INTO club_booking_settings (
  club_id,
  quality_weight,
  availability_bonus,
  role_match_bonus,
  offers_per_slot,
  fallback_limit
)
SELECT
  c.id,
  COALESCE(b.quality_weight, 100),
  COALESCE(b.availability_bonus, 30),
  COALESCE(b.role_match_bonus, 15),
  COALESCE(b.offers_per_slot, 10),
  COALESCE(b.fallback_limit, 5)
FROM clubs c
CROSS JOIN booking_scoring_config b
WHERE b.id = 'default'
ON CONFLICT (club_id) DO NOTHING;

ALTER TABLE club_booking_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on club_booking_settings"
  ON club_booking_settings
  FOR ALL
  USING (true)
  WITH CHECK (true);
