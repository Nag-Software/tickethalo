import { describeClubSetup, type SetupClub } from '@/lib/club-setup'

/**
 * Oppstartsguiden: det en ny klubb må gjøre før første show.
 *
 * Fire punkter, sjekket av fra det klubben faktisk har gjort — ikke fra
 * hva de har klikket på. Et punkt kan derfor aldri stå som gjort uten å
 * være det, og guiden trenger ingen egen tilstand. Rekkefølgen er den
 * rekkefølgen det lønner seg å gjøre tingene i: profilen er det publikum
 * ser, utbetalingen må være på plass før et show kan publiseres, og showet
 * må finnes før det kan publiseres.
 */

export type SetupGuideKey = 'profile' | 'payouts' | 'show' | 'publish'

export type SetupGuideStep = {
  key: SetupGuideKey
  label: string
  /** Én linje om hva som skjer når punktet gjøres. */
  hint: string
  href: string
  done: boolean
}

export type SetupGuide = {
  steps: SetupGuideStep[]
  doneCount: number
  /** Alle punktene er gjort. */
  complete: boolean
  /** Det første som gjenstår, så guiden kan peke på det. */
  next: SetupGuideStep | null
}

export type SetupGuideInput = {
  club: SetupClub & { logo_url: string | null; description: string | null }
  /** Show klubben har laget, uten maler og slettede. */
  showCount: number
  /** Show som er publisert eller alt avholdt. */
  publishedCount: number
}

export function describeSetupGuide(input: SetupGuideInput): SetupGuide {
  const { club } = input
  const profileDone = Boolean(club.logo_url) && Boolean(club.description?.trim())
  const payoutsDone = describeClubSetup(club).step === 'ready'

  const steps: SetupGuideStep[] = [
    {
      key: 'profile',
      label: 'Add your logo and a short description',
      hint: 'This is what the audience sees on your club page and tickets.',
      href: '/admin-app/my-club',
      done: profileDone,
    },
    {
      key: 'payouts',
      label: 'Set up payouts',
      hint: 'Who sells the tickets, and the Stripe account the money goes to.',
      href: '/admin-app/finances',
      done: payoutsDone,
    },
    {
      key: 'show',
      label: 'Create your first show',
      hint: 'Date, venue, price and the spots you want to book.',
      href: '/admin-app/shows/new',
      done: input.showCount > 0,
    },
    {
      key: 'publish',
      label: 'Publish it',
      hint: 'Tickets go on sale when you publish the show.',
      href: '/admin-app/shows',
      done: input.publishedCount > 0,
    },
  ]

  const doneCount = steps.filter((step) => step.done).length
  return {
    steps,
    doneCount,
    complete: doneCount === steps.length,
    next: steps.find((step) => !step.done) ?? null,
  }
}
