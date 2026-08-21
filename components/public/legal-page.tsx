import type { ReactNode } from 'react'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'

/**
 * Felles ramme for vilkårs- og personvernsidene.
 *
 * Sidene er en del av selgerstrukturen, ikke pynt: de er stedet der det står
 * skriftlig at klubben er selger og arrangør, og at Tickethalo formidler
 * billetten. Holdes de i én ramme, holdes de også i samme språk og form.
 */
export function LegalPage({
  title,
  intro,
  updated,
  children,
}: {
  title: string
  intro?: string
  updated: string
  children: ReactNode
}) {
  return (
    <main
      // The document root is still lang="nb" for the Norwegian portals — see
      // app/page.tsx for why this page declares its own language.
      lang="en"
      className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      <section className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 md:px-8 md:py-24">
        <h1 className="text-balance text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
          {title}
        </h1>
        {intro && (
          <p className="mt-4 text-[17px] leading-relaxed text-[var(--ev-muted)] sm:text-[15px]">{intro}</p>
        )}
        <p className="mt-3 text-[13px] text-[var(--ev-faint)]">Last updated {updated}</p>

        <div className="mt-10 flex flex-col gap-9">{children}</div>
      </section>

      <Footer />
    </main>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[19px] font-semibold tracking-[-0.01em] sm:text-[17px]">{title}</h2>
      <div className="flex flex-col gap-3 text-[16px] leading-relaxed text-[var(--ev-muted)] sm:text-[15px]">
        {children}
      </div>
    </section>
  )
}
