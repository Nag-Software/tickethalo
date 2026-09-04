-- ============================================================
-- Migration 044: Ingen godkjenningskø
--
-- Komikere slipper inn med én gang de registrerer seg. `status` er ikke
-- lenger en inngangsdør, men en nødbrems: superadmin kan sette noen til
-- `inactive` eller `rejected` og dermed ta hen ut av plattformen.
--
-- `pending_review` blir stående i check-constrainten for gamle rader og
-- for historikkens skyld, men ingenting produserer verdien lenger.
-- ============================================================

alter table artists alter column status set default 'approved';

-- Køen som aldri kommer til å bli behandlet. Disse har registrert seg og
-- ventet på en godkjenning som ikke finnes som steg lenger.
update artists set status = 'approved' where status = 'pending_review';
