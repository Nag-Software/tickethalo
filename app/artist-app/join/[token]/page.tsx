import Image from 'next/image'
import Link from 'next/link'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getArtistForAuthUser } from '@/lib/session'
import { inviteAcceptPath, isOnClubRoster, resolveClubInvite, type InviteClub } from '@/lib/club-invite'
import { shouldBypassImageOptimization } from '@/lib/utils'

export const metadata = { title: 'Join on Tickethalo', robots: { index: false } }

const primary =
  'inline-flex h-12 items-center justify-center rounded-full bg-[var(--ev-text)] px-6 text-[15px] font-semibold text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]'
const secondary =
  'inline-flex h-12 items-center justify-center rounded-full px-6 text-[15px] font-semibold ring-1 ring-[var(--ev-line-strong)] transition-colors hover:bg-[var(--ev-card-hover)]'

/**
 * Landingssiden for klubbens invitasjonslenke.
 *
 * Siden er offentlig og viser bare klubbens navn og logo. Hva komikeren kan
 * gjøre, avhenger av hvem hen er:
 *
 *  - utlogget: registrere seg eller logge inn, med `accept` som `next`;
 *  - innlogget komiker: ett trykk for å bli med, eller beskjed om at hen
 *    alt står på lista (også rett etter `accept`, som sender hit igjen);
 *  - død lenke (ukjent eller byttet token): registreringen er åpen likevel,
 *    bare uten klubben — og det står hvorfor.
 */
export default async function JoinClubPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const db = createAdminClient()

  const supabase = await createClient()
  const [club, { data: { user } }] = await Promise.all([resolveClubInvite(db, token), supabase.auth.getUser()])
  const artist = user ? await getArtistForAuthUser(user.id) : null
  const onRoster = club && artist ? await isOnClubRoster(db, club.id, artist.id) : false

  return (
    <main className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]" data-tone="light">
      <PublicHeader tone="light" />

      <section className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-4 pb-20 pt-32 text-center md:px-8">
        {club ? (
          <>
            <ClubMark club={club} />
            <p className="mt-6 text-[13px] text-[var(--ev-faint)]">Comedian invite</p>
            <h1 className="mt-2 text-balance text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
              {onRoster ? `You're on ${club.name}'s roster` : `${club.name} invites you to Tickethalo`}
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[var(--ev-muted)]">
              {onRoster
                ? `${club.name} can now offer you spots on their shows. Mark the dates you can't play, so offers only come when you're free.`
                : `Join ${club.name}'s roster to get offers for spots on their shows. Other clubs on Tickethalo can still find you too.`}
            </p>

            <div className="mt-8 flex w-full flex-col justify-center gap-3 sm:flex-row">
              {onRoster ? (
                <Link href="/artist-app/availability" className={primary}>
                  Go to your calendar
                </Link>
              ) : artist ? (
                // Ikke `Link`: den forhåndslaster, og `accept` skal bare kjøres
                // når komikeren faktisk trykker.
                <a href={inviteAcceptPath(token)} className={primary}>
                  Join {club.name}
                </a>
              ) : (
                <>
                  <Link href={`/artist-app/signup?next=${encodeURIComponent(inviteAcceptPath(token))}`} className={primary}>
                    Sign up
                  </Link>
                  <Link href={`/artist-app/login?next=${encodeURIComponent(inviteAcceptPath(token))}`} className={secondary}>
                    I already have a profile
                  </Link>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] text-[var(--ev-faint)]">Comedian invite</p>
            <h1 className="mt-2 text-balance text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
              This invite link is no longer active
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[var(--ev-muted)]">
              The club may have reset it. You can still use Tickethalo — ask the club for a new link to join their
              roster.
            </p>
            <div className="mt-8 flex w-full flex-col justify-center gap-3 sm:flex-row">
              {artist ? (
                <Link href="/artist-app" className={primary}>
                  Go to your portal
                </Link>
              ) : (
                <>
                  <Link href="/artist-app/signup" className={primary}>
                    Sign up
                  </Link>
                  <Link href="/artist-app/login" className={secondary}>
                    Log in
                  </Link>
                </>
              )}
            </div>
          </>
        )}
      </section>

      <Footer />
    </main>
  )
}

function ClubMark({ club }: { club: InviteClub }) {
  const initials = club.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()

  return (
    <div
      className="relative size-24 shrink-0 overflow-hidden ring-1 ring-[var(--ev-line)]"
      style={{ borderRadius: 'var(--ev-r-card)' }}
    >
      {club.logo_url ? (
        <Image
          src={club.logo_url}
          alt=""
          fill
          priority
          sizes="96px"
          unoptimized={shouldBypassImageOptimization(club.logo_url)}
          className="object-contain p-2"
        />
      ) : (
        <span className="grid h-full place-content-center text-2xl font-semibold text-[var(--ev-accent)]">
          {initials}
        </span>
      )}
    </div>
  )
}
