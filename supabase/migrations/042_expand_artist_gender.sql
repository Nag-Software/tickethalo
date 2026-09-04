-- ─────────────────────────────────────────────────────────────
-- Migration 042: Kjønn utvides, og verdiene får navn som betyr kjønn
--
-- 024 snevret artisten inn til ('male','female') fordi 'other' aldri kunne
-- matche et kjønnskrav — verdien var bookbar-død. Den feilen skal ikke
-- gjenskapes her: derfor legges `non_binary` inn på *begge* sider, slik at
-- en ikke-binær komiker faktisk kan etterspørres og ikke bare falle inn
-- under 'any'.
--
-- `prefer_not_to_say` finnes bare på artisten. Det er et ikke-svar, ikke en
-- gruppe et show kan booke etter, så den komikeren matcher krav satt til
-- 'any' og ingen andre.
--
-- Samtidig byttes 'male'/'female' til 'man'/'woman'. Kolonnen beskriver
-- kjønn, ikke biologi, og etikettene i grensesnittet sier allerede Woman
-- og Man.
-- ─────────────────────────────────────────────────────────────

-- ── Artisten ────────────────────────────────────────────────
alter table artists
  drop constraint if exists artists_gender_check;

update artists set gender = 'woman' where gender = 'female';
update artists set gender = 'man'   where gender = 'male';

alter table artists
  add constraint artists_gender_check
    check (gender is null or gender in ('woman', 'man', 'non_binary', 'prefer_not_to_say'));

-- ── Kravet showet stiller ───────────────────────────────────
alter table show_requirements
  drop constraint if exists show_requirements_required_gender_check;

update show_requirements set required_gender = 'woman' where required_gender = 'female';
update show_requirements set required_gender = 'man'   where required_gender = 'male';

alter table show_requirements
  add constraint show_requirements_required_gender_check
    check (required_gender in ('any', 'woman', 'man', 'non_binary'));
