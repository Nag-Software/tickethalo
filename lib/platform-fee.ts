/**
 * Formidlingsprovisjonen per klubb, slik superadmin setter den.
 *
 * Lagres som basispunkter i `clubs.platform_fee_bps` (1000 = 10 %), men
 * skrives og leses som prosent i skjemaet. Hele veien ned til Stripe leser
 * `commissionFor` kolonnen ved hvert kjøp, så en endring gjelder neste kjøp
 * og rører ikke ordrer som allerede er betalt.
 */

/** Standarden for nye klubber, samme som kolonnens default i migrasjon 032. */
export const DEFAULT_PLATFORM_FEE_BPS = 1000

/**
 * Under dette taper Tickethalo penger på hvert salg: Stripe tar rundt 3 % av
 * beløpet pluss ca. 3 kr per kjøp, og gebyret betales av plattformen. Grensen
 * er et skjemakrav, ikke en databaseregel — kolonnen tillater 0.
 */
export const MIN_PLATFORM_FEE_PERCENT = 5

export const MAX_PLATFORM_FEE_PERCENT = 30

export type CommissionInput = { bps: number } | { error: string }

/** «7», «7,5» og «7.5» er alle gyldige. Avrundes til nærmeste hundredels prosent. */
export function parseCommissionPercent(raw: FormDataEntryValue | null | undefined): CommissionInput {
  const text = String(raw ?? '').trim().replace(',', '.')
  if (!text) return { error: 'Provisjon er påkrevd.' }

  const percent = Number(text)
  if (!Number.isFinite(percent)) return { error: 'Provisjonen må være et tall.' }
  if (percent < MIN_PLATFORM_FEE_PERCENT || percent > MAX_PLATFORM_FEE_PERCENT) {
    return { error: `Provisjonen må være mellom ${MIN_PLATFORM_FEE_PERCENT} og ${MAX_PLATFORM_FEE_PERCENT} %.` }
  }

  return { bps: Math.round(percent * 100) }
}

/** 1000 → «10», 750 → «7.5». Til skjemaets startverdi og til tekst. */
export function formatCommissionPercent(bps: number): string {
  return String(bps / 100)
}
