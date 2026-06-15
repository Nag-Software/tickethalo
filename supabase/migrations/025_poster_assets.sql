-- ============================================================
-- Migration 025: Poster asset types and club defaults
-- ============================================================

alter table show_marketing_designs
  add column if not exists design_kind text not null default 'ai_reference'
    check (design_kind in ('ai_reference', 'frame_background'));

alter table clubs
  add column if not exists default_ai_poster_reference_url text,
  add column if not exists default_frame_background_url text;

alter table shows
  add column if not exists selected_ai_reference_id uuid,
  add column if not exists selected_frame_background_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shows_selected_ai_reference_id_fkey'
  ) then
    alter table shows
      add constraint shows_selected_ai_reference_id_fkey
      foreign key (selected_ai_reference_id)
      references show_marketing_designs(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'shows_selected_frame_background_id_fkey'
  ) then
    alter table shows
      add constraint shows_selected_frame_background_id_fkey
      foreign key (selected_frame_background_id)
      references show_marketing_designs(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_show_marketing_designs_kind on show_marketing_designs(show_id, design_kind);
create index if not exists idx_shows_selected_ai_reference_id on shows(selected_ai_reference_id);
create index if not exists idx_shows_selected_frame_background_id on shows(selected_frame_background_id);

-- Backfill show-level AI reference selection from legacy field
update shows
set selected_ai_reference_id = selected_marketing_design_id
where selected_marketing_design_id is not null
  and selected_ai_reference_id is null;
