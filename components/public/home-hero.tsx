import Link from 'next/link'

/**
 * Forsidens hero: ett fotografi med kortet oppå, og ingenting annet.
 *
 * To utsnitt av det samme motivet, begge beskåret slik at *begge* ansiktene
 * som ler er innenfor rammen — det er hele poenget med utsnittene, så en ny
 * beskjæring må bevare det:
 *   /hero-audience.webp        2200x1375 (16:10)  — fra 480px
 *   /hero-audience-mobile.webp 1120x1068 (~1:1)   — under 480px
 *
 * Rammen er aldri smalere enn utsnittet den viser, så `object-cover` beskjærer
 * bare i høyden og aldri i bredden — det er der ansiktene ligger. Derfor
 * skifter fil og rammeforhold på nøyaktig samme bruddpunkt (480px): sklir de
 * fra hverandre, klippes ansiktene av langs kantene.
 *
 * `<picture>` med media-query framfor to <Image>-elementer: et bilde lastes
 * ned selv når elementet er `display:none`, så to elementer ville hentet
 * begge filene. Én `<source>` gjør at nettleseren velger én fil og bare den.
 * next/image ville uansett ikke gjort noe her — `images.unoptimized` står på.
 */
export function HomeHero() {
  return (
    <section className="px-4 pb-6 pt-[5rem] md:px-8 md:pb-10 md:pt-25">
      <div
        className="animate-fade-in relative aspect-[1120/1068] max-h-[500px] w-full mx-auto overflow-hidden rounded-3xl bg-[var(--ev-poster-ground)] min-[480px]:aspect-[16/10] sm:aspect-[11/5]"
        style={{ animationFillMode: 'both' }}
      >
        <picture>
          <source media="(min-width: 720px)" srcSet="/hero-audience.webp" />
          <img
            src="/hero-audience-mobile.webp"
            alt="Two people laughing in the audience at a comedy club"
            width={1120}
            height={1068}
            fetchPriority="high"
            className="absolute inset-0 size-full object-cover"
          />
        </picture>

        {/* Kortet er smalere enn rammen på mobil med vilje: stripene langs
            sidene er der de to ansiktene stikker fram. */}
        <div className="absolute inset-0 grid place-items-center p-4 md:p-8">
          <div className="w-[86%] max-w-[440px] rounded-2xl bg-white px-5 py-5 text-center shadow-[0_16px_44px_-20px_rgba(0,0,0,0.55)] min-[360px]:w-[72%] sm:w-full md:px-9 md:py-8">
            <h1 className="text-balance text-[22px] font-semibold leading-[1.15] tracking-[-0.03em] text-[var(--ev-text)] md:text-[30px]">
              Hey, we are TicketHalo
              <span aria-hidden>🧡</span>
            </h1>
            {/* Bruddet er satt for hånd. Uten det havner "comedy club" alene
                på linje to og setningen mister rytmen. */}
            <p className="mt-2.5 text-[16px] text-[var(--ev-muted)] leading-[1.15] md:mt-3 md:text-[16px]">
              The easiest way<br/>
              to run a comedy club
            </p>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center md:mt-6 md:gap-2.5">
              {/* /admin-app er bare en redirect — ingenting å prefetche, og en
                  prefetchet redirect lander som en tom skjerm. */}
              <Link
                href="/admin-app"
                prefetch={false}
                // Samme mørke pille som «Buy» på eventkortene, inkludert
                // hover-vendingen til oransje.
                className="ev-hero-cta bg-[var(--ev-text)] text-[var(--ev-bg)] hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
              >
                For comedy clubs
              </Link>
              <Link
                href="/artist-app/login"
                className="ev-hero-cta border border-[var(--ev-accent)] hover:border-[var(--ev-accent-fill)] text-[var(--ev-text)] hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
              >
                Gigs for comedians
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
