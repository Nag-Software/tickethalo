import Stripe from 'stripe'

// Tidsavbruddet er satt ned fra SDK-ens 80 sekunder. Cron-jobbene og
// serverhandlingene har 60 sekunder totalt, og ett kall som henger skal ikke
// spise hele budsjettet — et nytt forsøk er tryggere enn en drept funksjon.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_missing', {
  apiVersion: '2026-08-26.dahlia',
  timeout: 20_000,
  maxNetworkRetries: 2,
})

/** Nøkkelen avgjør modus. Speiltabellene holder testdata og ekte penger adskilt. */
export function isStripeLiveMode(): boolean {
  return /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? '')
}
