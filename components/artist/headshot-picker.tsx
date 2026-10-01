"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ImagePlus, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  IMAGE_ACCEPT,
  MAX_UPLOAD_BYTES,
  UNSUPPORTED_IMAGE_MESSAGE,
  compressImageFile,
  isDisplayableImage,
} from "@/lib/image-compress"
import {
  HEADSHOT_EXAMPLE_SRC,
  HEADSHOT_PROBLEMS,
  HEADSHOT_RULES,
  type HeadshotVerdict,
} from "@/lib/headshot-guide"

type Status =
  | { kind: "idle" }
  | { kind: "checking"; preview: string }
  | { kind: "approved"; preview: string; token: string }
  | { kind: "rejected"; preview: string | null; message: string }

const primaryButton =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--ev-text)] px-5 text-[15px] font-semibold text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)] disabled:bg-[var(--ev-card-hover)] disabled:text-[var(--ev-faint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]"

/**
 * Headshotet i registreringsskjemaet. Komikeren ser først et eksempel og fire
 * korte krav, velger bilde, og får svar fra AI-sjekken i samme vindu — er det
 * avvist, står grunnen der og neste knapp er «Choose another photo».
 *
 * Fil-feltet og kvitteringen ligger i skjemaet, ikke i dialogen: dialogen
 * rendres i en portal utenfor `<form>`, og da ville de ikke blitt sendt med.
 */
export function HeadshotPicker({ onReadyChange }: { onReadyChange: (ready: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const inputRef = useRef<HTMLInputElement>(null)
  // Velger komikeren nytt bilde før svaret på det forrige er kommet, skal det
  // gamle svaret ikke vinne.
  const attempt = useRef(0)

  const approved = status.kind === "approved"
  useEffect(() => onReadyChange(approved), [approved, onReadyChange])

  const preview = status.kind === "idle" ? null : status.preview
  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  function clearInput() {
    if (inputRef.current) inputRef.current.value = ""
  }

  function reject(previewUrl: string | null, message: string) {
    clearInput()
    setStatus({ kind: "rejected", preview: previewUrl, message })
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    const current = ++attempt.current
    // Bildet vises med en gang; krympingen under tar et sekund på en telefon.
    const previewUrl = URL.createObjectURL(file)
    setStatus({ kind: "checking", preview: previewUrl })

    const compressed = await compressImageFile(file)
    if (compressed !== file) replaceSelectedFile(compressed)
    if (current !== attempt.current) return

    // Det som ligger i feltet, er det som sendes inn — og det er det som sjekkes.
    const selected = inputRef.current?.files?.[0] ?? compressed
    if (!isDisplayableImage(selected)) return reject(null, UNSUPPORTED_IMAGE_MESSAGE)
    if (selected.size > MAX_UPLOAD_BYTES) return reject(previewUrl, "The image is too large. Choose a smaller picture.")

    try {
      const body = new FormData()
      body.append("photo", selected)
      const response = await fetch("/artist-app/signup/check-photo", { method: "POST", body })
      if (!response.ok) throw new Error(`check-photo ${response.status}`)
      const verdict = (await response.json()) as HeadshotVerdict
      if (current !== attempt.current) return

      if (verdict.approved) {
        setStatus({ kind: "approved", preview: previewUrl, token: verdict.token })
      } else {
        reject(previewUrl, HEADSHOT_PROBLEMS[verdict.problem])
      }
    } catch {
      if (current !== attempt.current) return
      reject(previewUrl, "We could not check the photo. Check your connection and try again.")
    }
  }

  /** `input.files` kan bare settes med en DataTransfer — den mangler i eldre nettlesere. */
  function replaceSelectedFile(file: File) {
    const input = inputRef.current
    if (!input || typeof DataTransfer === "undefined") return
    try {
      const transfer = new DataTransfer()
      transfer.items.add(file)
      input.files = transfer.files
    } catch {
      // Beholder originalen; størrelsessjekken sier fra hvis den er for stor.
    }
  }

  function changeOpen(next: boolean) {
    setOpen(next)
    // Lukkes vinduet uten et godkjent bilde, skal ingenting ligge igjen i
    // skjemaet — heller ikke et avvist bilde eller et som sjekkes.
    if (!next && status.kind !== "approved") {
      attempt.current++
      clearInput()
      setStatus({ kind: "idle" })
    }
  }

  const choose = () => inputRef.current?.click()

  return (
    <>
      <input
        ref={inputRef}
        id="profile_image_file"
        name="profile_image_file"
        type="file"
        accept={IMAGE_ACCEPT}
        required
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      {status.kind === "approved" && <input type="hidden" name="profile_image_check" value={status.token} />}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-4 rounded-xl p-4 text-left transition-colors hover:bg-[var(--ev-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]",
          approved ? "ring-1 ring-inset ring-[var(--ev-line)]" : "border border-dashed border-[var(--ev-line-strong)]"
        )}
      >
        <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--ev-bg)] text-[var(--ev-muted)]">
          {approved ? (
            // eslint-disable-next-line @next/next/no-img-element -- lokal blob-URL
            <img src={status.preview} alt="" className="size-full object-cover" />
          ) : (
            <ImagePlus className="size-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          {approved ? (
            <span className="flex items-center gap-1.5 text-[13px] font-medium">
              <Check className="size-4 text-emerald-700" aria-hidden /> Photo approved
            </span>
          ) : (
            <span className="block text-[13px] font-medium">This photo will be used on posters.</span>
          )}
        </span>
        <span className="shrink-0 rounded-full bg-[var(--ev-text)] px-3.5 py-2 text-[13px] font-semibold text-[var(--ev-bg)]">
          {approved ? "Change" : "Choose Image"}
        </span>
      </button>

      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent
          className="ev-surface max-h-[calc(100svh-2rem)] max-w-md gap-5 overflow-y-auto bg-[var(--ev-bg)] text-[var(--ev-text)]"
          data-tone="light"
        >
          <DialogHeader>
            <DialogTitle className="text-[22px] font-semibold">Your headshot</DialogTitle>
            <DialogDescription className="text-[var(--ev-muted)]">
              It goes on show posters, so it should look like this.
            </DialogDescription>
          </DialogHeader>

          <div className="relative aspect-square max-h-[42svh] w-full overflow-hidden rounded-2xl bg-[var(--ev-card-hover)]">
            {/* eslint-disable-next-line @next/next/no-img-element -- eksempelet eller en lokal blob-URL */}
            <img
              src={preview ?? HEADSHOT_EXAMPLE_SRC}
              alt={preview ? "Your photo" : "Example: a comedian on stage, upper body, face clearly visible"}
              className={cn("size-full object-cover transition-opacity", status.kind === "checking" && "opacity-60")}
            />
            <StatusBadge status={status} />
          </div>

          <div aria-live="polite" className="contents">
            {status.kind === "rejected" && (
              <p className="rounded-xl bg-[var(--ev-card)] px-4 py-3 text-[14px] font-medium leading-snug text-[var(--ev-accent)]">
                {status.message}
              </p>
            )}
            {status.kind === "approved" && (
              <p className="text-[15px] font-medium">Looks great — this one works.</p>
            )}
          </div>

          {status.kind !== "approved" && (
            <ul className="grid gap-2 text-[14px]">
              {HEADSHOT_RULES.map((rule) => (
                <li key={rule} className="flex items-center gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--ev-card)]">
                    <Check className="size-3 text-[var(--ev-muted)]" aria-hidden />
                  </span>
                  {rule}
                </li>
              ))}
            </ul>
          )}

          {status.kind === "approved" ? (
            <div className="grid gap-2">
              <button type="button" className={primaryButton} onClick={() => setOpen(false)}>
                Use this photo
              </button>
              <button
                type="button"
                className="h-10 text-[14px] font-medium text-[var(--ev-muted)] underline-offset-4 hover:text-[var(--ev-text)] hover:underline"
                onClick={choose}
              >
                Choose another photo
              </button>
            </div>
          ) : (
            <button type="button" className={primaryButton} onClick={choose} disabled={status.kind === "checking"}>
              {status.kind === "checking" ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Checking your photo…
                </>
              ) : status.kind === "rejected" ? (
                "Choose another photo"
              ) : (
                "Choose photo"
              )}
            </button>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function StatusBadge({ status }: { status: Status }) {
  const badge = "absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold shadow-sm"

  switch (status.kind) {
    case "idle":
      return <span className={cn(badge, "bg-[var(--ev-bg)] text-[var(--ev-text)]")}>Example</span>
    case "checking":
      return (
        <span className={cn(badge, "bg-[var(--ev-bg)] text-[var(--ev-text)]")}>
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking
        </span>
      )
    case "approved":
      return (
        <span className={cn(badge, "bg-emerald-600 text-white")}>
          <Check className="size-3.5" aria-hidden /> Approved
        </span>
      )
    case "rejected":
      return status.preview ? (
        <span className={cn(badge, "bg-[var(--ev-accent-fill)] text-[var(--ev-accent-ink)]")}>
          <X className="size-3.5" aria-hidden /> Not approved
        </span>
      ) : null
  }
}
