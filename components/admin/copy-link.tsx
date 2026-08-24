'use client'

import { useState } from 'react'
import { ArrowUpRight, Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

/**
 * The link to the club page, ready to paste into a bio or a post.
 *
 * The URL itself is also marked `select-all`, so it can be grabbed manually
 * when the clipboard is blocked — the clipboard API requires a secure context,
 * and over plain http (local network, test hosting) there is none.
 */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Link copied.')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Select the link and copy it manually.')
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">Club page</div>

      <div className="flex h-11 items-center gap-2 rounded-2xl bg-zinc-100/80 pl-4 pr-1.5">
        <span className="min-w-0 flex-1 select-all truncate text-sm text-muted-foreground">{url}</span>

        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Open club page"
          className="grid size-8 shrink-0 place-content-center rounded-full text-muted-foreground transition-colors hover:bg-zinc-200 hover:text-foreground"
        >
          <ArrowUpRight className="size-4" aria-hidden />
          <span className="sr-only">Open club page</span>
        </a>

        <button
          type="button"
          onClick={copy}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
