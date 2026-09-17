-- ============================================================
-- Migration 042: AI poster brand kit
--
-- The per-show poster mode picker (template / ai_generated / framed) is
-- removed from the show flow: every show poster is AI-generated through a
-- two-stage pipeline. Stage 1 asks the image model for ARTWORK ONLY (no
-- text, no logos), optionally using the reference poster's cached clean
-- "plate" as edit base. Stage 2 composites text + logos deterministically
-- (sharp/SVG + bundled Geist fonts + real logo PNG crops) from a cached
-- per-reference "brand kit" — text slots, logo crops and palette extracted
-- ONCE from the reference. That cache is what keeps typography pixel-correct,
-- logos pixel-identical and results near-identical run after run.
--
-- shows.poster_use_reference is the new «Bruk referanseplakat» checkbox:
-- when true and a reference exists, stage 1 edits on top of its plate.
-- The poster_templates system (min-klubb maler) is untouched — it is simply
-- no longer selectable per show, so poster_mode is normalized to
-- 'ai_generated' (column + check constraint kept as-is, non-destructive).
-- ============================================================

alter table shows
  add column if not exists poster_use_reference boolean not null default true;

alter table show_marketing_designs
  add column if not exists brand_kit jsonb;

alter table clubs
  add column if not exists default_poster_brand_kit jsonb;

update shows
set poster_mode = 'ai_generated'
where poster_mode is distinct from 'ai_generated';
