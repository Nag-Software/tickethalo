'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { MAX_UPLOAD_BYTES, compressImageFile } from '@/lib/image-compress'

const inputClass =
  'w-full text-[13px] text-[var(--ev-muted)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--ev-card-hover)] file:px-3.5 file:py-2 file:text-[13px] file:font-medium file:text-[var(--ev-text)]'

/**
 * Et bilde rett fra mobilkameraet er større enn det server-action-et tar imot,
 * og plattformen svarer 413 før koden vår kjører. Derfor krymper vi bildet her
 * og bytter ut fila i feltet — skjemaet postes ellers akkurat som før.
 */
export function ProfileImageInput({ name = 'profile_image_file' }: { name?: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preparing, setPreparing] = useState(false)

  async function handleChange(file: File | undefined) {
    if (!file) return

    setPreparing(true)
    try {
      const compressed = await compressImageFile(file)
      if (compressed !== file) replaceSelectedFile(compressed)

      const selected = inputRef.current?.files?.[0] ?? compressed
      if (selected.size > MAX_UPLOAD_BYTES) {
        toast.error('The image is too large. Choose a smaller picture.')
        if (inputRef.current) inputRef.current.value = ''
      }
    } finally {
      setPreparing(false)
    }
  }

  /** `input.files` kan bare settes med en DataTransfer — den mangler i eldre nettlesere. */
  function replaceSelectedFile(file: File) {
    const input = inputRef.current
    if (!input || typeof DataTransfer === 'undefined') return
    try {
      const transfer = new DataTransfer()
      transfer.items.add(file)
      input.files = transfer.files
    } catch {
      // Beholder originalen; størrelsessjekken over sier fra hvis den er for stor.
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        name={name}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        // Feltet låses mens vi krymper, så ingen rekker å lagre originalen.
        disabled={preparing}
        className={inputClass}
        onChange={(event) => void handleChange(event.target.files?.[0])}
      />
      {preparing && <span className="text-[12px] text-[var(--ev-faint)]">Preparing image…</span>}
    </>
  )
}
