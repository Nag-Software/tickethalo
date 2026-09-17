import { redirect } from 'next/navigation'

/**
 * Den gamle siden med tre ledige datoer.
 *
 * Adressen står i e-poster som er sendt, så den blir stående og peker på
 * kalenderen. Se migrasjon 054 for hvorfor markeringen snudde.
 */
export default function AvailableDatesPage() {
  redirect('/artist-app/availability')
}
