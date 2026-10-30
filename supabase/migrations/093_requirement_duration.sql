-- ============================================================
-- Migrasjon 093: hvor mange minutter plassen gir
--
-- Komikeren må vite hvor lenge hen skal stå på scenen før hen sier ja —
-- det står i tilbudet, i portalen og i påminnelsen (ClickUp 869fn3w09 og
-- 869fn3w0z). Null = ikke satt, og da nevnes ikke varigheten noe sted.
--
-- Additivt. Koden som kjører nå leser ikke kolonnen.
-- ============================================================

alter table show_requirements
  add column if not exists duration_minutes integer;

comment on column show_requirements.duration_minutes is
  'Minutter på scenen for plassen. Null = ikke satt.';

alter table show_requirements drop constraint if exists show_requirements_duration_minutes_range;
alter table show_requirements
  add constraint show_requirements_duration_minutes_range
  check (duration_minutes is null or duration_minutes between 1 and 180);
