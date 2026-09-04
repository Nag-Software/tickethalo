-- Score settes ikke lenger for hånd i admin.
--
-- Bookingmotoren er fortsatt bygget på `admin_score`: den er sperren i
-- `strictFilter` og står for opptil 100 av ~145 poeng i rangeringen. Men
-- bookeren skal verken sette eller se tallet, og da kan ikke kolonnen bli
-- stående NULL — NULL leses som 0 og faller under terskelen på 6, slik at
-- komikeren aldri får et eneste tilbud.
--
-- Derfor: en default rett i basen, og en oppretting av dem som allerede
-- ligger uten verdi.

ALTER TABLE artists ALTER COLUMN admin_score SET DEFAULT 7;

UPDATE artists SET admin_score = 7 WHERE admin_score IS NULL;
