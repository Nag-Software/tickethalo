-- ============================================================
-- Migration 030: Index for the comedian list
--
-- Admin-lista henter `order by created_at desc limit 200`. Med
-- dagens seks rader er det en seq scan på 0,1 ms uansett, men
-- spørringen er den samme når rosteret er på tusen.
-- ============================================================

create index if not exists idx_artists_created_at
  on artists (created_at desc);
