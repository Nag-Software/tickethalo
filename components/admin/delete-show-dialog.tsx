'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, LoaderCircle, Trash2, TriangleAlert } from 'lucide-react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { isNextControlFlowError, useShowSalesAction } from '@/components/admin/show-sales-action'
import { DESTRUCTIVE_BOX, INLINE_ACTION_TRIGGER, WARNING_BOX } from '@/components/admin/show-sales-styles'
import { deleteShowAction, getShowSalesOverviewAction } from '@/app/admin-app/(protected)/shows/actions'
import { isTicketSalesStopped, type ShowSalesOverviewDto } from '@/lib/show-sales-shared'
import { cn } from '@/lib/utils'

/**
 * Sletting av et show, med det bookeren må vite før knappen trykkes.
 *
 * Dialogen spør serveren hva som vil skje når den åpnes, og viser ett av tre:
 *
 *  - blokkert: showet har salg som ikke er refundert. Slettingen er
 *    utilgjengelig, og stegene fram dit står i rekkefølge.
 *  - arkivering: alt er refundert, men showet har salgshistorikk. Det
 *    forsvinner for bookeren og publikum, radene står for regnskapet.
 *  - sletting: ingenting er noen gang solgt. Showet fjernes helt.
 *
 * Det dialogen viser er en forhåndsvisning. Selve avgjørelsen tas på nytt av
 * `delete_show()` under lås, så et kjøp som kommer i mellomtiden stopper
 * slettingen likevel — og da hentes tallene på nytt.
 *
 * Utløseren bygges her og ikke som `children`: se `BetaAccessDialog` for
 * hvorfor et element fra serveren ikke kan klones inn i Radix' `asChild`.
 */
export function DeleteShowDialog({
  showId,
  showTitle,
  variant = 'text',
  label,
}: {
  showId: string
  showTitle: string
  /** `text` og `icon` er dempet til hover, `danger` er rød hele tiden — som `DeleteButton`. */
  variant?: 'text' | 'icon' | 'danger'
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [overview, setOverview] = useState<ShowSalesOverviewDto | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [understood, setUnderstood] = useState(false)
  const [isLoading, startLoading] = useTransition()
  const { isPending, run } = useShowSalesAction()

  const triggerLabel = label ?? (variant === 'danger' ? 'Delete show' : 'Delete')

  function load() {
    setLoadError(null)
    startLoading(async () => {
      try {
        const result = await getShowSalesOverviewAction(showId)
        if ('error' in result) {
          setOverview(null)
          setLoadError(result.error)
          return
        }
        setOverview(result)
      } catch (error) {
        if (isNextControlFlowError(error)) throw error
        setOverview(null)
        setLoadError(error instanceof Error && error.message ? error.message : 'Could not check ticket sales for this show.')
      }
    })
  }

  function submit(outcome: ShowSalesOverviewDto['deletion']) {
    const formData = new FormData()
    formData.set('show_id', showId)

    run(
      () => deleteShowAction(formData),
      (result) => {
        if (result?.error) {
          toast.error(result.error)
          // Noe har endret seg siden dialogen åpnet. Vis det som gjelder nå.
          setUnderstood(false)
          load()
          return
        }
        toast.success(outcome === 'archive' ? `“${showTitle}” was deleted and archived.` : `“${showTitle}” was deleted.`)
        setOpen(false)
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // En sletting som er underveis skal ikke se avbrutt ut.
        if (!next && isPending) return
        setOpen(next)
        if (next) {
          setUnderstood(false)
          load()
        }
      }}
    >
      <DialogTrigger
        aria-label={variant === 'icon' ? `${triggerLabel}: ${showTitle}` : undefined}
        className={cn(
          INLINE_ACTION_TRIGGER,
          variant === 'danger' ? 'font-medium text-destructive' : 'text-muted-foreground',
        )}
      >
        <Trash2 className="size-3.5" aria-hidden />
        {variant !== 'icon' && triggerLabel}
      </DialogTrigger>

      <DialogContent lang="en" className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {overview && !isLoading ? (
          overview.deletion === 'blocked' ? (
            <BlockedLayout overview={overview} onNavigate={() => setOpen(false)} />
          ) : overview.deletion === 'archive' ? (
            <ArchiveLayout
              title={overview.title}
              understood={understood}
              onUnderstoodChange={setUnderstood}
              pending={isPending}
              onConfirm={() => submit('archive')}
            />
          ) : (
            <DeleteLayout title={overview.title} pending={isPending} onConfirm={() => submit('delete')} />
          )
        ) : loadError && !isLoading ? (
          <>
            <DialogHeader>
              <DialogTitle>Couldn&apos;t check ticket sales</DialogTitle>
              <DialogDescription>{loadError}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
              <Button onClick={load}>Try again</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Delete “{showTitle}”?</DialogTitle>
              <DialogDescription className="flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                Checking ticket sales and refunds…
              </DialogDescription>
            </DialogHeader>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function BlockedLayout({ overview, onNavigate }: { overview: ShowSalesOverviewDto; onNavigate: () => void }) {
  const salesStopped = isTicketSalesStopped(overview.sales)

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
          This show can&apos;t be deleted yet
        </DialogTitle>
        <DialogDescription>
          “{overview.title}” has ticket sales that are not refunded. A show can only be deleted once every buyer
          has been refunded.
        </DialogDescription>
      </DialogHeader>

      <div role="alert" className={DESTRUCTIVE_BOX}>
        <ul className="list-disc space-y-1 pl-4">
          {overview.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      </div>

      <ol className="space-y-2.5">
        <Step
          number={1}
          done={salesStopped}
          title="Stop ticket sales"
          detail={salesStopped ? 'Done. Nobody can start a new purchase.' : 'So no new tickets are sold while you refund.'}
        />
        <Step
          number={2}
          done={false}
          title="Refund all tickets"
          detail="Every buyer gets a full refund and all tickets become invalid."
        />
        <Step number={3} done={false} title="Delete the show" detail="Come back here once everything is refunded." />
      </ol>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Close</Button>
        </DialogClose>
        <Button asChild>
          <Link href={`/admin-app/shows/${overview.showId}?tab=tickets`} onClick={onNavigate}>
            Go to ticket sales
          </Link>
        </Button>
        <Button variant="destructive" disabled title="Refund all tickets before deleting the show">
          <Trash2 aria-hidden />
          Delete show
        </Button>
      </DialogFooter>
    </>
  )
}

function Step({ number, done, title, detail }: { number: number; done: boolean; title: string; detail: string }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums',
          done
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {done ? <Check className="size-3.5" aria-label="Done" /> : number}
      </span>
      <div className="min-w-0">
        <p className={cn('text-sm font-medium', done && 'text-muted-foreground line-through decoration-1')}>{title}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </li>
  )
}

function ArchiveLayout({
  title,
  understood,
  onUnderstoodChange,
  pending,
  onConfirm,
}: {
  title: string
  understood: boolean
  onUnderstoodChange: (value: boolean) => void
  pending: boolean
  onConfirm: () => void
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete “{title}”?</DialogTitle>
        <DialogDescription>All ticket sales on this show have been refunded.</DialogDescription>
      </DialogHeader>

      <div role="alert" className={WARNING_BOX}>
        <p className="flex items-center gap-1.5 font-medium">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          The show has sales history, so it is archived
        </p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          <li>It disappears from your show lists and from the public event pages.</li>
          <li>Orders, refunds and invoice history are kept for accounting.</li>
          <li>Pending booking offers and confirmed lineup spots are cancelled.</li>
          <li>You can&apos;t undo this.</li>
        </ul>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={understood}
          onChange={(event) => onUnderstoodChange(event.target.checked)}
          disabled={pending}
          className="mt-0.5 size-4 shrink-0"
        />
        I understand that the show is removed from Tickethalo and can&apos;t be restored.
      </label>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button variant="destructive" disabled={!understood || pending} onClick={onConfirm}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
          {pending ? 'Deleting…' : 'Delete show'}
        </Button>
      </DialogFooter>
    </>
  )
}

function DeleteLayout({ title, pending, onConfirm }: { title: string; pending: boolean; onConfirm: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete “{title}”?</DialogTitle>
        <DialogDescription>No tickets have ever been sold for this show.</DialogDescription>
      </DialogHeader>

      <div role="alert" className={WARNING_BOX}>
        This permanently deletes the show together with its lineup, booking offers and marketing material. You
        can&apos;t undo this.
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button variant="destructive" disabled={pending} onClick={onConfirm}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
          {pending ? 'Deleting…' : 'Delete permanently'}
        </Button>
      </DialogFooter>
    </>
  )
}
