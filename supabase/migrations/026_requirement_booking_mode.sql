alter table show_requirements
  add column if not exists booking_mode text not null default 'auto';

do $$
begin
  alter table show_requirements
    add constraint show_requirements_booking_mode_check
    check (booking_mode in ('auto', 'manual'));
exception
  when duplicate_object then null;
end $$;
