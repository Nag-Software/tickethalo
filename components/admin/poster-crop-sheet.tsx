'use client'

import * as React from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cropImageToPosterBlob, POSTER_CROP_ASPECT } from '@/lib/crop-image'

type PosterCropSheetProps = {
  open: boolean
  imageSrc: string | null
  fileName: string
  onOpenChange: (open: boolean) => void
  onConfirm: (blob: Blob) => void | Promise<void>
}

export function PosterCropSheet({
  open,
  imageSrc,
  fileName,
  onOpenChange,
  onConfirm,
}: PosterCropSheetProps) {
  const [crop, setCrop] = React.useState({ x: 0, y: 0 })
  const [zoom, setZoom] = React.useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = React.useState<Area | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCroppedAreaPixels(null)
    setIsSaving(false)
  }, [open, imageSrc])

  async function handleSave() {
    if (!imageSrc || !croppedAreaPixels) return
    setIsSaving(true)
    try {
      const blob = await cropImageToPosterBlob(imageSrc, croppedAreaPixels)
      await onConfirm(blob)
      onOpenChange(false)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[min(92vh,820px)] sm:max-w-none">
        <SheetHeader>
          <SheetTitle>Beskær plakat</SheetTitle>
          <SheetDescription>
            Juster utsnittet til 2:3 ({fileName}). Dra bildet og bruk zoom for å treffe riktig ramme.
          </SheetDescription>
        </SheetHeader>

        <div className="relative mx-auto mt-2 h-[min(52vh,480px)] w-full max-w-lg overflow-hidden rounded-lg border bg-muted/30">
          {imageSrc ? (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={POSTER_CROP_ASPECT}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_area, pixels) => setCroppedAreaPixels(pixels)}
              objectFit="contain"
            />
          ) : null}
        </div>

        <label className="mx-auto mt-4 flex w-full max-w-lg items-center gap-3 text-sm">
          <span className="shrink-0 text-muted-foreground">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-full accent-primary"
          />
        </label>

        <SheetFooter className="sm:flex-row sm:justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Avbryt
          </Button>
          <Button type="button" onClick={handleSave} disabled={!imageSrc || !croppedAreaPixels || isSaving}>
            {isSaving ? 'Lagrer...' : 'Bruk plakat'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
