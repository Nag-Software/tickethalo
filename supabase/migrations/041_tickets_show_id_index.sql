-- Public show listings count sold tickets by filtering tickets on (show_id, status)
-- — e.g. lib/public-events.ts withTicketCounts(). Postgres does not auto-index foreign
-- key columns, so tickets.show_id was unindexed and each count fell back to a sequential
-- scan that grows with total ticket volume. A composite (show_id, status) index serves
-- the exact filter used by the public site.
create index if not exists idx_tickets_show_id_status on tickets (show_id, status);
