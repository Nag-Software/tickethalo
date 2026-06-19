
import Link from 'next/link'

export function Footer() {
    return (
      <footer className="border-t border-border py-6 text-center text-sm font-medium text-zinc-500">
        <div className="mb-2 flex flex-wrap items-center justify-center gap-2 px-4">
          <span className="tracking-normal text-black">humor.events</span>™
          <span className="mx-2 text-zinc-300">|</span>
          <span>Norges morsomste kvelder</span>
        </div>
        <Link href="/artist-app/login" className="hover:text-black transition-colors">Komikerportalen</Link>
      </footer>
    );
}