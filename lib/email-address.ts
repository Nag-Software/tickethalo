/**
 * Om en e-postadresse kan brukes. Ingen avhengigheter, så både skjemaer i
 * nettleseren og handlingene på serveren kan bruke den.
 *
 * Bevisst enkel: én @, noe på begge sider, en punktum i domenet og ingen
 * mellomrom. Strengere regler avviser ekte adresser; Resend avviser resten.
 */
export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@"<>,;]+@[^\s@"<>,;]+\.[^\s@"<>,;.]{2,}$/.test(email)
}
