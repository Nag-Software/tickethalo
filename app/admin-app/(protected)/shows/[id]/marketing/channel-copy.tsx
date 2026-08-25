'use client'

import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Teksten som skal limes inn sammen med filene.
 *
 * Et Facebook-event er ikke ferdig fordi coverbildet er laget — noen må
 * fortsatt skrive tittel, lineup og praktisk info inn i skjemaet. Den teksten
 * er allerede kjent, så den er skrevet ferdig her.
 */

type CopyBlock = {
  key: string
  label: string
  hint: string
  value: string
  multiline: boolean
}

export function ChannelCopy({
  eventTitle,
  eventDescription,
  caption,
  ticketUrl,
}: {
  eventTitle: string
  eventDescription: string
  caption: string
  ticketUrl: string | null
}) {
  const blocks: CopyBlock[] = [
    { key: 'title', label: 'Facebook event title', hint: 'Paste into the event name field.', value: eventTitle, multiline: false },
    { key: 'description', label: 'Facebook event description', hint: 'Lineup and practical info.', value: eventDescription, multiline: true },
    { key: 'caption', label: 'Social caption', hint: 'For the feed post and the story.', value: caption, multiline: true },
    ...(ticketUrl ? [{ key: 'link', label: 'Ticket link', hint: 'The URL on the event and in bio.', value: ticketUrl, multiline: false }] : []),
  ]

  return (
    <section className="rounded-xl border bg-card">
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Copy for the channels</h2>
        <p className="text-xs text-muted-foreground">Written from the show and the booked lineup.</p>
      </header>

      <div className="divide-y">
        {blocks.map((block) => (
          <CopyRow key={block.key} block={block} />
        ))}
      </div>
    </section>
  )
}

function CopyRow({ block }: { block: CopyBlock }) {
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(block.value)
      setCopied(true)
      toast.success(`${block.label} copied.`)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard-API-et krever sikker kontekst. Over http finnes den ikke, og
      // da er `select-all` på teksten under den eneste veien videre.
      toast.error('Could not copy. Select the text and copy it manually.')
    }
  }

  return (
    <div className="space-y-1.5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium">{block.label}</p>
          <p className="truncate text-[11px] text-muted-foreground">{block.hint}</p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors hover:bg-muted"
        >
          {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <pre className="max-h-40 select-all overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 px-2.5 py-2 font-sans text-[11px] leading-relaxed text-muted-foreground">
        {block.value}
      </pre>
    </div>
  )
}
