'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Spørsmålet etter «Remove»: hvem fyller plassen nå?
 *
 * Før startet motoren en ny runde med tilbud av seg selv. Bookeren ville
 * heller velge (ClickUp 869fn3vwn). Lukkes dialogen uten valg, står plassen
 * på pause med de samme to knappene i lineupen — ingenting går ut før det.
 */
export function RebookChoiceDialog({
  roleName,
  open,
  pending,
  onOpenChange,
  onChooseYourself,
  onAutoBookNew,
}: {
  roleName: string | null
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onChooseYourself: () => void
  onAutoBookNew: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent lang="en">
        <DialogHeader>
          <DialogTitle>Who should fill the {roleName ?? 'open'} spot?</DialogTitle>
          <DialogDescription>
            No new offers go out until you choose. The comedian you removed won’t be offered this show again.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onChooseYourself}>
            Choose yourself
          </Button>
          <Button type="button" disabled={pending} onClick={onAutoBookNew}>
            Auto-book new
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
