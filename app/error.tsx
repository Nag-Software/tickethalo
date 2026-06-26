'use client'

import Link from 'next/link'

// Catches render/data errors on any route below the root layout (the public site,
// mostly). Keeps the user inside branded, Norwegian chrome with a working retry instead
// of Next's default error screen.
export default function Error({
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <main className="public-shell flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center text-foreground">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Noe gikk galt</h1>
        <p className="mt-2 max-w-md text-sm text-zinc-500">
          Vi klarte ikke å laste denne siden akkurat nå. Prøv igjen — eller gå tilbake til forsiden.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => unstable_retry()}
          className="rounded-xl bg-vipps-orange px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-vipps-orange-60"
        >
          Prøv igjen
        </button>
        <Link
          href="/"
          className="rounded-xl border border-border px-6 py-3 text-sm font-medium transition-colors hover:bg-black hover:text-white"
        >
          Til forsiden
        </Link>
      </div>
    </main>
  )
}
