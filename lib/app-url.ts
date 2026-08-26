/**
 * Én kilde til domenet appen bor på.
 *
 * Domenet lå tidligere spredt: tre steder leste `NEXT_PUBLIC_SITE_URL` — en
 * variabel som aldri har vært satt, så lenkene i e-postene pekte på
 * `http://localhost:3000` — og e-postmalene hadde `https://tickethalo.com`
 * hardkodet ved siden av. Da fantes det to svar på hva domenet var, og
 * hvilket du fikk avhang av hvilket kallsted som sendte e-posten.
 *
 * `APP_URL` først, `NEXT_PUBLIC_APP_URL` som fallback for klientkode som ikke
 * ser server-variabelen. Ingen `VERCEL_URL`: den er deploy-spesifikk og bak
 * deployment protection, så en e-post med den lenken går til en innloggingsvegg
 * på en URL som dør ved neste opprydding. Mangler variabelen, er localhost i
 * utvikling riktigere enn en lenke som nesten virker.
 */
export function appUrl() {
  const origin = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return origin.replace(/\/$/, '')
}

/** Sti under appens domene, f.eks. `appPath('/artist-app/bookings')`. */
export function appPath(path: string) {
  return `${appUrl()}${path.startsWith('/') ? path : `/${path}`}`
}
