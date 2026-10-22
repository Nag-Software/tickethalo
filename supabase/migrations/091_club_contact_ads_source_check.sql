-- ============================================================
-- Migrasjon 091: annonsesamtykket må ha en kilde
--
-- Sjekken fra 090 slapp gjennom samtykke uten kilde: `null in (...)` er
-- null, ikke false, og en CHECK som blir null, godtas. Nå står det rett ut
-- at kilden ikke kan mangle når tidspunktet finnes.
--
-- Ingen kontakter har annonsesamtykke ennå, så den nye sjekken treffer
-- ingen eksisterende rader.
-- ============================================================

alter table club_contacts drop constraint if exists club_contacts_ads_consent_source_check;
alter table club_contacts
  add constraint club_contacts_ads_consent_source_check
  check (
    (ads_consent_at is null and ads_consent_source is null)
    or (
      ads_consent_at is not null
      and ads_consent_source is not null
      and ads_consent_source in ('purchase', 'import')
    )
  );
