'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  normalizePhotoFrame,
  normalizeTextSlot,
  type NormBox,
  type PosterPhotoFrame,
  type PosterTemplateSchema,
  type PosterTextRole,
  type PosterTextSlot,
} from '@/lib/poster-template'

type ElementRef =
  | { kind: 'text'; index: number }
  | { kind: 'frame'; index: number }
  | { kind: 'logo'; index: number }

type Props = {
  templateId: string
  initialName: string
  initialSchema: PosterTemplateSchema
  plateUrl: string | null
  status: 'draft' | 'confirmed'
  isClubDefault: boolean
  initialPreviewDataUrl: string | null
  saveAction: (formData: FormData) => Promise<unknown>
  confirmAction: (formData: FormData) => Promise<unknown>
  previewAction: (formData: FormData) => Promise<{ dataUrl: string }>
}

const TEXT_ROLES: PosterTextRole[] = ['title', 'headliner', 'lineup', 'date', 'venue', 'footer', 'custom']
const ROLE_LABELS: Record<PosterTextRole, string> = {
  title: 'Tittel',
  headliner: 'Headliner',
  lineup: 'Lineup',
  date: 'Dato',
  venue: 'Sted',
  footer: 'Footer',
  custom: 'Egen tekst',
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

export function PosterTemplateEditor(props: Props) {
  const router = useRouter()
  const [name, setName] = React.useState(props.initialName)
  const [schema, setSchema] = React.useState<PosterTemplateSchema>(props.initialSchema)
  const [selected, setSelected] = React.useState<ElementRef | null>(null)
  const [preview, setPreview] = React.useState<string | null>(props.initialPreviewDataUrl)
  const [previewing, setPreviewing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [setDefault, setSetDefault] = React.useState(!props.isClubDefault)

  const canvasRef = React.useRef<HTMLDivElement>(null)
  const previewTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const aspect = props.initialSchema.canvasWidth / props.initialSchema.canvasHeight

  const refreshPreview = React.useCallback(async (next: PosterTemplateSchema) => {
    setPreviewing(true)
    try {
      const fd = new FormData()
      fd.set('template_id', props.templateId)
      fd.set('schema', JSON.stringify(next))
      const { dataUrl } = await props.previewAction(fd)
      setPreview(dataUrl)
    } catch {
      // a failed preview is non-fatal; the editor overlay still reflects edits
    } finally {
      setPreviewing(false)
    }
  }, [props])

  // Uten en server-rendret forhåndsvisning henter vi den ved mount, slik at
  // editoren kan vises umiddelbart mens plakaten rendres i bakgrunnen.
  React.useEffect(() => {
    if (props.initialPreviewDataUrl === null) void refreshPreview(props.initialSchema)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commitSchema = React.useCallback((next: PosterTemplateSchema) => {
    setSchema(next)
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => void refreshPreview(next), 650)
  }, [refreshPreview])

  function updateBox(ref: ElementRef, box: NormBox) {
    const next: PosterTemplateSchema = { ...schema }
    if (ref.kind === 'text') {
      next.textSlots = schema.textSlots.map((s, i) => (i === ref.index ? { ...s, box } : s))
    } else if (ref.kind === 'frame') {
      next.photoFrames = schema.photoFrames.map((f, i) => (i === ref.index ? { ...f, box } : f))
    } else {
      next.logos = schema.logos.map((l, i) => (i === ref.index ? { ...l, box } : l))
    }
    commitSchema(next)
  }

  function patchTextSlot(index: number, patch: Partial<PosterTextSlot>) {
    commitSchema({ ...schema, textSlots: schema.textSlots.map((s, i) => (i === index ? { ...s, ...patch } : s)) })
  }
  function patchFrame(index: number, patch: Partial<PosterPhotoFrame>) {
    commitSchema({ ...schema, photoFrames: schema.photoFrames.map((f, i) => (i === index ? { ...f, ...patch } : f)) })
  }

  function addTextSlot() {
    const slot = normalizeTextSlot({ role: 'custom', box: { x: 0.3, y: 0.45, width: 0.4, height: 0.08 }, align: 'center', color: '#ffffff', fontWeight: 600 })
    const next = { ...schema, textSlots: [...schema.textSlots, slot] }
    commitSchema(next)
    setSelected({ kind: 'text', index: next.textSlots.length - 1 })
  }
  function addFrame() {
    const frame = normalizePhotoFrame({ box: { x: 0.35, y: 0.35, width: 0.3, height: 0.24 }, shape: 'rounded' })
    const next = { ...schema, photoFrames: [...schema.photoFrames, frame] }
    commitSchema(next)
    setSelected({ kind: 'frame', index: next.photoFrames.length - 1 })
  }
  function removeSelected() {
    if (!selected) return
    const next: PosterTemplateSchema = { ...schema }
    if (selected.kind === 'text') next.textSlots = schema.textSlots.filter((_, i) => i !== selected.index)
    else if (selected.kind === 'frame') next.photoFrames = schema.photoFrames.filter((_, i) => i !== selected.index)
    else next.logos = schema.logos.filter((_, i) => i !== selected.index)
    setSelected(null)
    commitSchema(next)
  }

  // Pointer drag/resize against the canvas rect, in normalized coordinates.
  function startInteraction(event: React.PointerEvent, ref: ElementRef, mode: 'move' | 'resize') {
    event.preventDefault()
    event.stopPropagation()
    setSelected(ref)
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const box = boxFor(ref)
    if (!box) return
    const startX = event.clientX
    const startY = event.clientY
    const start = { ...box }

    function onMove(e: PointerEvent) {
      const dx = (e.clientX - startX) / rect.width
      const dy = (e.clientY - startY) / rect.height
      let nb: NormBox
      if (mode === 'move') {
        nb = {
          x: clamp01(start.x + dx),
          y: clamp01(start.y + dy),
          width: start.width,
          height: start.height,
        }
        nb.x = Math.min(nb.x, 1 - nb.width)
        nb.y = Math.min(nb.y, 1 - nb.height)
      } else {
        nb = {
          x: start.x,
          y: start.y,
          width: Math.min(Math.max(0.04, start.width + dx), 1 - start.x),
          height: Math.min(Math.max(0.03, start.height + dy), 1 - start.y),
        }
      }
      updateBox(ref, nb)
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function boxFor(ref: ElementRef): NormBox | null {
    if (ref.kind === 'text') return schema.textSlots[ref.index]?.box ?? null
    if (ref.kind === 'frame') return schema.photoFrames[ref.index]?.box ?? null
    return schema.logos[ref.index]?.box ?? null
  }

  async function handleSave() {
    setSaving(true)
    try {
      const fd = new FormData()
      fd.set('template_id', props.templateId)
      fd.set('name', name)
      fd.set('schema', JSON.stringify(schema))
      await props.saveAction(fd)
      toast.success('Malen er lagret.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kunne ikke lagre malen.')
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirm() {
    setConfirming(true)
    try {
      const saveFd = new FormData()
      saveFd.set('template_id', props.templateId)
      saveFd.set('name', name)
      saveFd.set('schema', JSON.stringify(schema))
      await props.saveAction(saveFd)

      const fd = new FormData()
      fd.set('template_id', props.templateId)
      fd.set('set_default', setDefault ? 'true' : 'false')
      await props.confirmAction(fd)
      toast.success(setDefault ? 'Malen er bekreftet og satt som klubbstandard.' : 'Malen er bekreftet.')
      router.push('/admin-app/min-klubb')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kunne ikke bekrefte malen.')
    } finally {
      setConfirming(false)
    }
  }

  const selectedText = selected?.kind === 'text' ? schema.textSlots[selected.index] : null
  const selectedFrame = selected?.kind === 'frame' ? schema.photoFrames[selected.index] : null

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* Left: editor canvas + live preview */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Rediger plassering (dra boksene)</p>
          <div
            ref={canvasRef}
            onPointerDown={() => setSelected(null)}
            className="relative w-full select-none overflow-hidden rounded-lg border bg-neutral-900"
            style={{ aspectRatio: String(aspect), backgroundImage: props.plateUrl ? `url(${props.plateUrl})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            {schema.photoFrames.map((frame, index) => (
              <Overlay key={`f${index}`} box={frame.box} active={selected?.kind === 'frame' && selected.index === index} color="#38bdf8" label="Bilde"
                onMove={(e) => startInteraction(e, { kind: 'frame', index }, 'move')}
                onResize={(e) => startInteraction(e, { kind: 'frame', index }, 'resize')} />
            ))}
            {schema.logos.map((logo, index) => (
              <Overlay key={`l${index}`} box={logo.box} active={selected?.kind === 'logo' && selected.index === index} color="#f59e0b" label="Logo"
                onMove={(e) => startInteraction(e, { kind: 'logo', index }, 'move')}
                onResize={(e) => startInteraction(e, { kind: 'logo', index }, 'resize')} />
            ))}
            {schema.textSlots.map((slot, index) => (
              <Overlay key={`t${index}`} box={slot.box} active={selected?.kind === 'text' && selected.index === index} color="#a78bfa" label={ROLE_LABELS[slot.role]}
                onMove={(e) => startInteraction(e, { kind: 'text', index }, 'move')}
                onResize={(e) => startInteraction(e, { kind: 'text', index }, 'resize')} />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Forhåndsvisning</p>
            <button type="button" onClick={() => void refreshPreview(schema)} className="text-xs text-muted-foreground hover:text-foreground">
              {previewing ? 'Oppdaterer…' : 'Oppdater'}
            </button>
          </div>
          <div className="overflow-hidden rounded-lg border bg-neutral-900" style={{ aspectRatio: String(aspect) }}>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Forhåndsvisning" className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Ingen forhåndsvisning ennå</div>
            )}
          </div>
        </div>
      </div>

      {/* Right: controls */}
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Navn på mal</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/30" />
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={addTextSlot} className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">+ Tekst</button>
          <button type="button" onClick={addFrame} className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">+ Bilderamme</button>
          {selected && (
            <button type="button" onClick={removeSelected} className="rounded-md border border-red-300 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50">Fjern valgt</button>
          )}
        </div>

        {selectedText && selected && (
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-semibold">Tekstfelt</p>
            <Field label="Rolle">
              <select value={selectedText.role} onChange={(e) => patchTextSlot(selected.index, { role: e.target.value as PosterTextRole })} className="select">
                {TEXT_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </Field>
            {selectedText.role === 'custom' || selectedText.role === 'footer' ? (
              <Field label="Tekst">
                <input value={selectedText.text ?? ''} onChange={(e) => patchTextSlot(selected.index, { text: e.target.value })} placeholder={selectedText.role === 'footer' ? 'BILLETTER · HUMOR.EVENTS' : 'Egen tekst'} className="input" />
              </Field>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Farge">
                <input type="color" value={selectedText.color} onChange={(e) => patchTextSlot(selected.index, { color: e.target.value })} className="h-8 w-full rounded border" />
              </Field>
              <Field label="Vekt">
                <select value={selectedText.fontWeight} onChange={(e) => patchTextSlot(selected.index, { fontWeight: Number(e.target.value) as 400 | 500 | 600 | 700 })} className="select">
                  <option value={400}>Normal</option>
                  <option value={500}>Medium</option>
                  <option value={600}>Halvfet</option>
                  <option value={700}>Fet</option>
                </select>
              </Field>
              <Field label="Justering">
                <select value={selectedText.align} onChange={(e) => patchTextSlot(selected.index, { align: e.target.value as 'left' | 'center' | 'right' })} className="select">
                  <option value="left">Venstre</option>
                  <option value="center">Midtstilt</option>
                  <option value="right">Høyre</option>
                </select>
              </Field>
              <Field label="Maks linjer">
                <input type="number" min={1} max={6} value={selectedText.maxLines} onChange={(e) => patchTextSlot(selected.index, { maxLines: Math.max(1, Math.min(6, Number(e.target.value))) })} className="input" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={selectedText.uppercase} onChange={(e) => patchTextSlot(selected.index, { uppercase: e.target.checked })} />
              STORE BOKSTAVER
            </label>
          </div>
        )}

        {selectedFrame && selected && (
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-semibold">Bilderamme</p>
            <Field label="Form">
              <select value={selectedFrame.shape} onChange={(e) => patchFrame(selected.index, { shape: e.target.value as 'rect' | 'rounded' | 'circle' })} className="select">
                <option value="rect">Firkant</option>
                <option value="rounded">Avrundet</option>
                <option value="circle">Sirkel</option>
              </select>
            </Field>
            <Field label={`Navnefelt (${Math.round(selectedFrame.labelRatio * 100)}%)`}>
              <input type="range" min={0} max={0.4} step={0.02} value={selectedFrame.labelRatio} onChange={(e) => patchFrame(selected.index, { labelRatio: Number(e.target.value) })} className="w-full" />
            </Field>
          </div>
        )}

        {!selected && (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            Klikk på en boks i editoren for å endre den. Lilla = tekst, blå = bilde, oransje = logo.
          </p>
        )}

        <div className="space-y-2 border-t pt-4">
          <Button type="button" onClick={() => void handleSave()} disabled={saving} className="w-full">
            {saving ? 'Lagrer…' : 'Lagre'}
          </Button>
          <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={setDefault} onChange={(e) => setSetDefault(e.target.checked)} />
            Sett som klubbstandard
          </label>
          <Button type="button" variant="secondary" onClick={() => void handleConfirm()} disabled={confirming} className="w-full">
            {confirming ? 'Bekrefter…' : props.status === 'confirmed' ? 'Lagre og bekreft på nytt' : 'Bekreft mal'}
          </Button>
        </div>
      </div>

      <style>{`
        .input { width:100%; border-radius:0.375rem; border:1px solid var(--border); background:transparent; padding:0.375rem 0.5rem; font-size:0.75rem; outline:none; }
        .select { width:100%; border-radius:0.375rem; border:1px solid var(--border); background:transparent; padding:0.375rem 0.5rem; font-size:0.75rem; outline:none; }
      `}</style>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function Overlay({ box, active, color, label, onMove, onResize }: {
  box: NormBox
  active: boolean
  color: string
  label: string
  onMove: (e: React.PointerEvent) => void
  onResize: (e: React.PointerEvent) => void
}) {
  return (
    <div
      onPointerDown={onMove}
      className="absolute cursor-move"
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
        border: `1.5px solid ${color}`,
        background: active ? `${color}22` : 'transparent',
        boxShadow: active ? `0 0 0 1px ${color}` : undefined,
      }}
    >
      <span className="pointer-events-none absolute -top-4 left-0 text-[9px] font-semibold" style={{ color }}>{label}</span>
      <div
        onPointerDown={onResize}
        className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-sm border bg-white"
        style={{ borderColor: color }}
      />
    </div>
  )
}
