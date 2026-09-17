'use client'

import { useId, useState } from 'react'
import { ArrowUpRight, Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import {
  FIELD_ADDON_BUTTON_CLASS,
  FIELD_GROUP_CLASS,
  FIELD_HINT_CLASS,
  FIELD_INPUT_CLASS,
} from '@/components/admin/form-fields'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * The link to the club page, ready to paste into a bio or a post.
 *
 * The URL stands in a read-only field that selects itself on focus, so it can
 * be grabbed manually when the clipboard is blocked — the clipboard API
 * requires a secure context, and over plain http (local network, test hosting)
 * there is none. The field has no name, so it is never submitted with the form.
 */
export function CopyLink({ url, className }: { url: string; className?: string }) {
  const id = useId()
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
    <Field className={cn('col-span-12 min-w-0 gap-1.5', className)}>
      <FieldLabel htmlFor={id}>Club page</FieldLabel>
      <div className={FIELD_GROUP_CLASS}>
        <Input
          id={id}
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className={cn(FIELD_INPUT_CLASS, 'text-muted-foreground')}
        />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label="Open club page"
          title="Open club page"
          className={FIELD_ADDON_BUTTON_CLASS}
        >
          <ArrowUpRight className="size-4" aria-hidden />
        </a>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Link copied' : 'Copy link'}
          title="Copy link"
          className={FIELD_ADDON_BUTTON_CLASS}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </button>
      </div>
      <FieldDescription className={FIELD_HINT_CLASS}>Ready to paste into a bio or a post.</FieldDescription>
    </Field>
  )
}
