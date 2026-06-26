'use client'

import './globals.css'

// Replaces the root layout when an error is thrown in the layout itself, so it must
// render its own <html>/<body>.
export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <html lang="nb">
      <body className="min-h-full">
        <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
          <div>
            <h1 className="text-3xl font-medium tracking-tight">Noe gikk galt</h1>
            <p className="mt-2 max-w-md text-sm text-zinc-500">
              En uventet feil oppstod. Prøv igjen, eller kom tilbake litt senere.
            </p>
          </div>
          <button
            onClick={() => unstable_retry()}
            className="rounded-xl bg-vipps-orange px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-vipps-orange-60"
          >
            Prøv igjen
          </button>
        </main>
      </body>
    </html>
  )
}
