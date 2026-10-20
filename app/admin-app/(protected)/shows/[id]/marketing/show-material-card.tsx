'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Check, Copy, Download, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * «Show marketing material»: det klubben trenger for å lage sin egen post
 * eller plakat — komikerbildene, QR-koden til showsiden og teksten — vist
 * her og samlet i én zip.
 */
export function ShowMaterialCard({
  comedians,
  qrDataUrl,
  publicUrl,
  text,
  downloadHref,
}: {
  comedians: Array<{ artistId: string; name: string; imageUrl: string | null }>
  qrDataUrl: string
  publicUrl: string
  text: string
  downloadHref: string
}) {
  const [copied, setCopied] = useState(false)

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Select the text and copy it yourself.')
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Show marketing material</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Photos of the comedians, a QR code to the show page and the show text.
          </p>
        </div>
        {/* En vanlig lenke: ruten svarer med en zip, og nettleseren laster den ned. */}
        <a href={downloadHref} className={cn(buttonVariants(), 'shrink-0')} download>
          <Download />
          Download all show material
        </a>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {comedians.map((comedian) => (
          <figure key={comedian.artistId} className="flex min-w-0 flex-col gap-1.5">
            {comedian.imageUrl ? (
              <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-muted">
                <Image src={comedian.imageUrl} alt="" fill sizes="160px" className="object-cover" />
              </div>
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <UserRound className="size-6" />
              </div>
            )}
            <figcaption className="truncate text-xs font-medium">{comedian.name}</figcaption>
          </figure>
        ))}
        <figure className="flex min-w-0 flex-col gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- data-URL laget på serveren */}
          <img src={qrDataUrl} alt={`QR code to ${publicUrl}`} className="aspect-square w-full rounded-xl border bg-white object-contain p-1" />
          <figcaption className="truncate text-xs font-medium">QR code</figcaption>
        </figure>
      </div>
      {comedians.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">No comedians in the line-up yet. Their photos show up here when they are booked.</p>
      )}

      <div className="mt-5 rounded-xl border bg-muted/30">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">Show text</span>
          <button type="button" onClick={() => void copyText()} className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap px-4 py-3 font-sans text-sm leading-relaxed">{text}</pre>
      </div>
    </section>
  )
}
