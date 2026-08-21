'use client'

import { useState } from 'react'
import { LocationField, type SelectedLocation } from '@/components/artist/location-field'
import { LanguageField } from '@/components/artist/language-field'
import { defaultLanguagesForCountry, lookupCountry } from '@/lib/geo'
import { normalizeLanguages, type LanguageCode } from '@/lib/languages'

/**
 * Sted + språk som ett par, for profilsiden.
 *
 * De to hører sammen fordi valg av by foreslår språket landet snakker, og
 * det krever delt state. Profilsiden er en server-komponent, så paret må bo
 * i en klientkomponent — samme oppsett som i registreringsskjemaet.
 */
export function LocationLanguageFields({
  initialCity,
  initialCountry,
  initialLanguages,
}: {
  initialCity: string | null
  initialCountry: string | null
  initialLanguages: string[] | null
}) {
  const [location, setLocation] = useState<SelectedLocation | null>(
    initialCity && initialCountry ? { city: initialCity, country: initialCountry } : null
  )
  const [languages, setLanguages] = useState<LanguageCode[]>(normalizeLanguages(initialLanguages))
  const [suggestedFrom, setSuggestedFrom] = useState<string | null>(null)

  const selectLocation = (next: SelectedLocation) => {
    setLocation(next)

    // Et bevisst språkvalg skal ikke overskrives fordi man flyttet.
    if (languages.length > 0) return
    const suggestion = defaultLanguagesForCountry(next.country)
    if (suggestion.length === 0) return
    setLanguages(suggestion)
    setSuggestedFrom(lookupCountry(next.country)?.name ?? next.country)
  }

  return (
    <>
      <label className="grid gap-2">
        <span className="text-[13px] font-medium">Location</span>
        <LocationField id="profile-location" value={location} onChange={selectLocation} />
      </label>

      <div className="grid gap-2">
        <span className="text-[13px] font-medium">Language</span>
        <LanguageField value={languages} onChange={setLanguages} suggestedFrom={suggestedFrom} />
      </div>
    </>
  )
}
