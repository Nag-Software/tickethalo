-- ─────────────────────────────────────────────────────────────
-- Migration 025: Sted og språk på artist
--
-- To ting henger sammen her:
--
-- 1. `city` + `country` er nytt. Klubber har hatt sted hele tiden, artister
--    ikke. Når komikere etter hvert bookes utenfor Norge må en booker kunne
--    begrense til sitt eget land, og det krever at landet står på artisten.
--
-- 2. `language` var én fritekstkolonne og hadde allerede rukket å samle
--    «Norsk», «Begge» og «Norsk og engelsk» for det som er samme to språk.
--    Den erstattes av `languages text[]` med ISO 639-1-koder, slik at en
--    komiker kan oppgi flere språk uten at det blir en ny skrivemåte.
--
-- Backfill under konverterer all eksisterende fritekst før den gamle
-- kolonnen fjernes — ingen informasjon går tapt, den bytter format.
-- ─────────────────────────────────────────────────────────────

alter table artists
  add column if not exists city text,
  add column if not exists country text,
  add column if not exists languages text[];

-- Land lagres som ISO 3166-1 alpha-2, alltid store bokstaver.
alter table artists
  drop constraint if exists artists_country_format_check;
alter table artists
  add constraint artists_country_format_check
    check (country is null or country ~ '^[A-Z]{2}$');

-- ── Backfill språk ───────────────────────────────────────────
-- Dekker verdiene som faktisk står i basen i dag, samt de engelske
-- variantene skjemaet rakk å skrive. Alt annet blir null og settes på nytt
-- av komikeren eller av admin.
update artists
set languages = case
  when lower(trim(language)) in ('begge', 'both', 'norsk og engelsk', 'norwegian and english', 'norsk/engelsk')
    then array['no', 'en']
  when lower(trim(language)) in ('norsk', 'norwegian', 'no', 'nb', 'nn')
    then array['no']
  when lower(trim(language)) in ('engelsk', 'english', 'en')
    then array['en']
  when lower(trim(language)) in ('svensk', 'swedish', 'sv') then array['sv']
  when lower(trim(language)) in ('dansk', 'danish', 'da') then array['da']
  else null
end
where language is not null
  and languages is null;

-- ── Backfill land ────────────────────────────────────────────
-- Alle artister i basen i dag er norske: samtlige `language`-verdier er
-- norske, og tjenesten har kun kjørt i Norge. Nye registreringer setter
-- landet selv via stedvelgeren.
update artists
set country = 'NO'
where country is null;

alter table artists
  drop column if exists language;

-- Landfiltrering er hele poenget med kolonnen, så den får en indeks med en gang.
create index if not exists artists_country_idx on artists (country);
