/**
 * Klassene dialogene og salgspanelet deler.
 *
 * Egen modul uten `'use client'`: salgspanelet er en serverkomponent, og en
 * konstant importert fra en klientmodul blir en klientreferanse — ikke
 * strengen — når den leses på serveren.
 */

/** Samme utseende som `DeleteButton`, så en utløser ser ut som knappen den erstatter. */
export const INLINE_ACTION_TRIGGER =
  'inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors hover:bg-destructive/10 hover:text-destructive'

export const WARNING_BOX =
  'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'

export const DESTRUCTIVE_BOX =
  'rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive dark:bg-destructive/20'
