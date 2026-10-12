/**
 * Foretaksnummeret, slik det ser ut der klubben er registrert.
 *
 * Norge: organisasjonsnummer, ni sifre. Danmark: CVR-nummer, åtte sifre.
 * Sverige: organisationsnummer, ti sifre, ofte skrevet med bindestrek før de
 * fire siste. Lagres uten mellomrom og bindestrek, så billetten og
 * avregningsnotaen viser samme tall uansett hvordan det ble skrevet inn.
 */

type Rule = { label: string; digits: number; example: string }

const RULES: Record<string, Rule> = {
  NO: { label: 'Organisation number', digits: 9, example: '999 999 999' },
  DK: { label: 'CVR number', digits: 8, example: '12345678' },
  SE: { label: 'Organisationsnummer', digits: 10, example: '556677-8899' },
}

function ruleFor(country: string | null | undefined): Rule {
  return RULES[country ?? ''] ?? RULES.NO
}

/** Hva feltet heter i skjemaet. */
export function orgNumberFieldLabel(country: string | null | undefined): string {
  return ruleFor(country).label
}

export function orgNumberPlaceholder(country: string | null | undefined): string {
  return ruleFor(country).example
}

export type OrgNumberInput = { value: string | null } | { error: string }

/** Tomt felt er lov (null); et utfylt felt må ha riktig antall sifre for landet. */
export function parseOrgNumber(raw: string | null | undefined, country: string | null | undefined): OrgNumberInput {
  const text = (raw ?? '').replace(/[\s-]/g, '')
  if (!text) return { value: null }

  const rule = ruleFor(country)
  if (!new RegExp(`^\\d{${rule.digits}}$`).test(text)) {
    return { error: `The ${rule.label.toLowerCase()} must be ${rule.digits} digits.` }
  }
  return { value: text }
}
