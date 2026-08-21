-- ─────────────────────────────────────────────────────────────
-- Migration 024: Kjønn på artist er kun 'male' eller 'female'
--
-- 009 la på `check (gender in ('male','female','other'))`, men
-- `show_requirements.required_gender` har hele tiden vært begrenset til
-- ('male','female','any'). En artist med 'other' kunne derfor aldri matche
-- et kjønnskrav — verdien var bookbar-død fra dag én. Registreringsskjemaet
-- tilbyr ikke lenger 'other', og denne strammer databasen til det samme.
--
-- Trygt å kjøre: ingen rader har 'other' i dag.
-- ─────────────────────────────────────────────────────────────

alter table artists
  drop constraint if exists artists_gender_check;

alter table artists
  add constraint artists_gender_check
    check (gender is null or gender in ('male', 'female'));
