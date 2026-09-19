'use client'

import { useEffect, useState, useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, MoreVertical, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { shouldBypassImageOptimization } from '@/lib/utils'
import { RoleIcon } from '@/components/admin/show-booking-card'
import { SpotIconButton, SpotNumber, SubmissionsBar, SubmissionsToggle, spotCardClass } from './lineup-ui'
import { cn } from '@/lib/utils'
import { PublishShowDialog } from '@/components/admin/publish-show-dialog'
import type { PublishReadinessItem } from '@/lib/publish-readiness'
import {
  addRequirementAction,
  deleteRequirementAction,
  removeSpotAndReopenAction,
  moveSpotAction,
  movePendingOfferAction,
  swapArtistAction,
  addArtistToRequirementAction,
  sendOfferToArtistAction,
  cancelOfferAction,
  updateOfferStatusAction,
  openRequirementEnergyLevelsAction,
} from '../actions'
import type { RequirementCompensationType, RequirementEnergy, RequirementGender, SubmissionsAudience } from '@/types/database'

type Artist = {
  id: string
  full_name: string
  stage_name: string | null
  email: string
  profile_image_url: string | null
}

type SelectableArtist = {
  id: string
  full_name: string
  stage_name: string | null
  email: string
}

type Requirement = {
  id: string
  role_name: string
  quantity: number
  lineup_position: number
  energy_level: RequirementEnergy
  required_gender: RequirementGender
  submissions_open: boolean
  compensation_type: RequirementCompensationType | null
  compensation_amount: number | null
  compensation_percent: number | null
}

type ConfirmedSpot = {
  id: string
  artist_id: string
  show_requirement_id: string
  status: string
  fee_amount: number | null
  currency: string | null
}

type BookingOffer = {
  id: string
  artist_id: string
  show_requirement_id: string | null
  status: string
  sent_at: string | null
}

type DragItem =
  | { type: 'spot'; id: string }
  | { type: 'offer'; id: string }

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  completed: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
  paid: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400',
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmed',
  completed: 'Completed',
  paid: 'Paid',
}

/** Pillen som bærer status, både på bekreftede plasser og tilbud som venter. */
const STATUS_PILL_CLASS = 'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium'

const LINEUP_REFRESH_INTERVAL_MS = 4000
const EMPTY_STATE_ENERGY_PROMPT_DELAY_MS = 300000

const ENERGY_LABELS: Record<RequirementEnergy, string> = {
  any: 'Any',
  high: 'High',
  low: 'Low',
  uncertain: 'Unknown',
}

const GENDER_LABELS: Record<RequirementGender, string> = {
  any: 'Any',
  woman: 'Women',
  man: 'Men',
  non_binary: 'Non-binary',
}

function formatEditableNumber(value: number | null) {
  if (value == null) return ''
  return Number.isInteger(value) ? String(value) : String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.0$/, '')
}

function formatRequirementCurrency(minorAmount: number | null, currency: string) {
  if (minorAmount == null) return 'Not set'

  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(minorAmount / 100)
  } catch {
    // `Intl` kaster på en kode den ikke kjenner. Honoraret på en bekreftet
    // plass har sin egen valuta fra da tilbudet gikk ut, og et skjevt felt der
    // skal ikke ta ned hele lineupen.
    return `${Math.round(minorAmount / 100)} ${currency}`
  }
}

/** Honoraret slik det står på plassen — prosenten eller kronebeløpet. */
function requirementFee(requirement: Requirement, currency: string) {
  if (requirement.compensation_type === 'fixed') {
    return formatRequirementCurrency(requirement.compensation_amount, currency)
  }

  if (requirement.compensation_type === 'percent') {
    return requirement.compensation_percent == null
      ? 'Not set'
      : `${formatEditableNumber(requirement.compensation_percent)}%`
  }

  return 'Not set'
}

function requirementSummary(requirement: Requirement, currency: string) {
  const fee = requirementFee(requirement, currency)

  return [
    `Energy ${ENERGY_LABELS[requirement.energy_level] ?? requirement.energy_level}`,
    `Gender ${GENDER_LABELS[requirement.required_gender] ?? requirement.required_gender}`,
    fee,
  ]
}

export function LineupTab({
  showId,
  showTitle,
  showStatus,
  showCurrency,
  requirements,
  confirmedSpots,
  allOffers,
  artistMap,
  selectableArtists,
  energyRelaxationSuggestions,
  allSlotsFilled,
  publishReadiness,
  submissionsAudience,
  submissionsCloseAt,
  rosterSize,
  pendingByRequirement,
}: {
  showId: string
  showTitle: string
  showStatus: string
  showCurrency: string
  requirements: Requirement[]
  confirmedSpots: ConfirmedSpot[]
  allOffers: BookingOffer[]
  artistMap: Record<string, Artist>
  selectableArtists: SelectableArtist[]
  energyRelaxationSuggestions: Record<string, { candidates: number }>
  allSlotsFilled: boolean
  /** Det event-siden mangler før publisering — se `lib/publish-readiness.ts`. */
  publishReadiness: PublishReadinessItem[]
  submissionsAudience: SubmissionsAudience
  submissionsCloseAt: string | null
  rosterSize: number
  pendingByRequirement: Record<string, number>
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // "Add" panel per requirement
  const [openAddReqId, setOpenAddReqId] = useState<string | null>(null)
  const [addArtistId, setAddArtistId] = useState('')

  // "Send offer" panel per requirement
  const [openOfferReqId, setOpenOfferReqId] = useState<string | null>(null)
  const [offerArtistId, setOfferArtistId] = useState('')

  // "Move" panel per requirement
  const [openMoveReqId, setOpenMoveReqId] = useState<string | null>(null)
  const [moveOfferId, setMoveOfferId] = useState('')

  // "Swap comedian" panel per spot
  const [swapSpotId, setSwapSpotId] = useState<string | null>(null)
  const [swapArtistId, setSwapArtistId] = useState('')

  // Requirement info panel per spot
  const [openInfoReqId, setOpenInfoReqId] = useState<string | null>(null)
  const [energyPromptStartedAtByReq, setEnergyPromptStartedAtByReq] = useState<Record<string, number>>({})
  const [energyPromptClock, setEnergyPromptClock] = useState(() => Date.now())

  // Drag state
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [dragOverReqId, setDragOverReqId] = useState<string | null>(null)

  const activeSpots = confirmedSpots.filter(s =>
    ['confirmed', 'completed', 'paid'].includes(s.status)
  )
  const sentOfferCount = allOffers.filter(o => o.status === 'sent').length
  const shouldAutoRefresh = showStatus === 'booking' && (!allSlotsFilled || sentOfferCount > 0)
  // Etter showet er lineupen en protokoll, ikke en plan. Da slettes ingenting.
  const isPastShow = showStatus === 'completed' || showStatus === 'cancelled'
  const emptyEnergyPromptReqKey = requirements.flatMap((req) => {
    const reqSpots = activeSpots.filter(s => s.show_requirement_id === req.id)
    const reqPending = allOffers.filter(o => o.show_requirement_id === req.id && o.status === 'sent')
    const hasSuggestion = Boolean(energyRelaxationSuggestions[req.id])
    return showStatus === 'booking' && hasSuggestion && reqSpots.length === 0 && reqPending.length === 0
      ? [req.id]
      : []
  }).join('|')

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const eligibleReqIds = emptyEnergyPromptReqKey ? emptyEnergyPromptReqKey.split('|') : []
      const eligibleReqIdSet = new Set(eligibleReqIds)

      setEnergyPromptStartedAtByReq((previous) => {
        const next: Record<string, number> = {}
        let changed = Object.keys(previous).some((reqId) => !eligibleReqIdSet.has(reqId))

        for (const reqId of eligibleReqIds) {
          next[reqId] = previous[reqId] ?? Date.now()
          if (!previous[reqId]) changed = true
        }

        return changed ? next : previous
      })
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [emptyEnergyPromptReqKey])

  useEffect(() => {
    if (!emptyEnergyPromptReqKey) return
    const interval = window.setInterval(() => setEnergyPromptClock(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [emptyEnergyPromptReqKey])

  useEffect(() => {
    if (!shouldAutoRefresh) return

    const refresh = () => {
      if (document.visibilityState === 'visible' && !isPending) {
        router.refresh()
      }
    }

    const interval = window.setInterval(refresh, LINEUP_REFRESH_INTERVAL_MS)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [isPending, router, shouldAutoRefresh])

  /**
   * Sletter hele spoten — kravet og radene under det.
   *
   * Til forskjell fra «Remove», som frigjør plassen og starter en ny
   * tilbudsrunde, skal plassen her bort. Står det noen på den, bekreftes det
   * først: bookingene deres avlyses med kravet.
   */
  function handleDeleteRequirement(reqId: string, roleName: string, occupied: number) {
    if (
      occupied > 0 &&
      !window.confirm(
        `Delete the ${roleName} spot? ${occupied} booking${occupied === 1 ? '' : 's'} on it will be cancelled.`,
      )
    ) {
      return
    }

    startTransition(async () => {
      const fd = new FormData()
      fd.set('show_id', showId)
      fd.set('req_id', reqId)
      try {
        await deleteRequirementAction(fd)
        toast.success('Spot deleted from the lineup.')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  /** Samme plass én gang til — rolle, kriterier og honorar følger med. */
  function handleDuplicateRequirement(req: Requirement) {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('show_id', showId)
      fd.set('role_name', req.role_name)
      fd.set('quantity', String(req.quantity))
      fd.set('energy_level', req.energy_level)
      fd.set('required_gender', req.required_gender)
      fd.set('compensation_type', req.compensation_type ?? '')
      // Beløpet ligger i minor units her, og handlingen ganger opp igjen.
      fd.set('compensation_amount', req.compensation_amount == null ? '' : String(req.compensation_amount / 100))
      fd.set('compensation_percent', req.compensation_percent == null ? '' : String(req.compensation_percent))
      try {
        const result = await addRequirementAction(fd)
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        toast.success('Lineup spot duplicated.')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  /**
   * `cancelled` skiller komikerens eget avbud fra at klubben ombestemte seg.
   * Bare avbudet teller på scoren — se `savePerformanceReview`.
   */
  function handleRemoveSpot(spotId: string, reason: 'club' | 'cancelled' = 'club') {
    // Et avbud teller dobbelt på komikerens score, og vurderingen kan ikke
    // rettes fra lineupen etterpå — plassen er da borte fra den.
    if (reason === 'cancelled' && !window.confirm(
      'Mark this as the comedian cancelling? It counts against their score and cannot be undone here.'
    )) return

    startTransition(async () => {
      const fd = new FormData()
      fd.set('spot_id', spotId)
      fd.set('show_id', showId)
      if (reason === 'cancelled') fd.set('artist_cancelled', 'true')
      try {
        await removeSpotAndReopenAction(fd)
        toast.success(reason === 'cancelled'
          ? 'Marked as a cancellation. A new offer round starts automatically.'
          : 'Artist removed. A new offer round starts automatically.')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  function handleAddArtist(reqId: string) {
    if (!addArtistId) return
    startTransition(async () => {
      const fd = new FormData()
      fd.set('show_id', showId)
      fd.set('artist_id', addArtistId)
      fd.set('show_requirement_id', reqId)
      fd.set('currency', showCurrency)
      try {
        await addArtistToRequirementAction(fd)
        toast.success('Artist added to the lineup.')
        setOpenAddReqId(null)
        setAddArtistId('')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  function handleSendOffer(reqId: string) {
    if (!offerArtistId) return
    startTransition(async () => {
      const fd = new FormData()
      fd.set('show_id', showId)
      fd.set('artist_id', offerArtistId)
      fd.set('show_requirement_id', reqId)
      try {
        await sendOfferToArtistAction(fd)
        toast.success('Offer sent to the comedian.')
        setOpenOfferReqId(null)
        setOfferArtistId('')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  function handleMovePendingOfferToRequirement(offerId: string, reqId: string) {
    if (!offerId) return
    startTransition(async () => {
      const fd = new FormData()
      fd.set('offer_id', offerId)
      fd.set('show_requirement_id', reqId)
      fd.set('show_id', showId)
      try {
        await movePendingOfferAction(fd)
        toast.success('Offer moved.')
        setOpenMoveReqId(null)
        setMoveOfferId('')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  function handleSwapArtist(spotId: string) {
    if (!swapArtistId) return
    startTransition(async () => {
      const fd = new FormData()
      fd.set('spot_id', spotId)
      fd.set('new_artist_id', swapArtistId)
      fd.set('show_id', showId)
      try {
        await swapArtistAction(fd)
        toast.success('Artist swapped.')
        setSwapSpotId(null)
        setSwapArtistId('')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  function handleCancelOffer(offerId: string) {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('offer_id', offerId)
      fd.set('show_id', showId)
      try {
        await cancelOfferAction(fd)
        toast.success('Offer withdrawn.')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  function handleApproveOffer(offerId: string) {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('offer_id', offerId)
      fd.set('show_id', showId)
      fd.set('status', 'accepted')
      try {
        await updateOfferStatusAction(fd)
        toast.success('Artist approved and added to the lineup.')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  function handleOpenEnergyLevels(reqId: string) {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('show_id', showId)
      fd.set('req_id', reqId)
      try {
        await openRequirementEnergyLevelsAction(fd)
        toast.success('Energy level opened up. Booking retries automatically.')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not open up the energy level')
      }
    })
  }

  function handleSpotDragStart(e: React.DragEvent, spotId: string) {
    e.dataTransfer.effectAllowed = 'move'
    setDragItem({ type: 'spot', id: spotId })
  }

  function handleOfferDragStart(e: React.DragEvent, offerId: string) {
    e.dataTransfer.effectAllowed = 'move'
    setDragItem({ type: 'offer', id: offerId })
  }

  function handleDragEnd() {
    setDragItem(null)
    setDragOverReqId(null)
  }

  function handleDragOver(e: React.DragEvent, reqId: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverReqId(reqId)
  }

  function handleDragLeave(e: React.DragEvent) {
    // only clear if leaving the card entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverReqId(null)
    }
  }

  function handleDrop(e: React.DragEvent, reqId: string) {
    e.preventDefault()
    const droppedItem = dragItem
    setDragItem(null)
    setDragOverReqId(null)
    if (!droppedItem) return

    if (droppedItem.type === 'spot') {
      const spot = activeSpots.find(s => s.id === droppedItem.id)
      if (!spot || spot.show_requirement_id === reqId) return

      startTransition(async () => {
        const fd = new FormData()
        fd.set('spot_id', droppedItem.id)
        fd.set('show_requirement_id', reqId)
        fd.set('show_id', showId)
        try {
          await moveSpotAction(fd)
          router.refresh()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Something went wrong')
        }
      })
      return
    }

    const offer = allOffers.find(o => o.id === droppedItem.id)
    if (!offer || offer.show_requirement_id === reqId || offer.status !== 'sent') return

    startTransition(async () => {
      const fd = new FormData()
      fd.set('offer_id', droppedItem.id)
      fd.set('show_requirement_id', reqId)
      fd.set('show_id', showId)
      try {
        await movePendingOfferAction(fd)
        toast.success('Offer moved.')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong')
      }
    })
  }

  const unassignedOffers = allOffers.filter(o => !o.show_requirement_id && o.status === 'sent')
  const pendingOfferArtistIds = new Set(allOffers.filter(o => o.status === 'sent').map(o => o.artist_id))
  const totalSlots = requirements.reduce((sum, req) => sum + req.quantity, 0)
  const filledSlots = requirements.reduce((sum, req) => {
    const reqFilled = activeSpots.filter(s => s.show_requirement_id === req.id).length
    return sum + Math.min(reqFilled, req.quantity)
  }, 0)
  const offerableArtists = selectableArtists.filter(a => !pendingOfferArtistIds.has(a.id))

  const pendingSubmissionTotal = Object.values(pendingByRequirement).reduce((sum, count) => sum + count, 0)

  return (
    <div className="space-y-3">
      {/* Søknadsinnstillingene hører hjemme her også — det er denne fanen
          bookeren står i mens søknadene faktisk kommer inn. */}
      {requirements.length > 0 && (
        <SubmissionsBar
          showId={showId}
          audience={submissionsAudience}
          closeAt={submissionsCloseAt}
          rosterSize={rosterSize}
          pendingTotal={pendingSubmissionTotal}
          disabled={showStatus === 'completed' || showStatus === 'cancelled'}
        />
      )}

      {requirements.map((req, index) => {
        const reqSpots = activeSpots.filter(s => s.show_requirement_id === req.id)
        const reqPending = allOffers.filter(
          o => o.show_requirement_id === req.id && o.status === 'sent'
        )
        const isLocked = reqSpots.length >= req.quantity
        const canAcceptDraggedItem = Boolean(dragItem) && !isLocked
        const isDragOver = dragOverReqId === req.id && canAcceptDraggedItem
        const isInfoOpen = openInfoReqId === req.id
        const summaryItems = requirementSummary(req, showCurrency)
        const energySuggestion = energyRelaxationSuggestions[req.id]
        const energyPromptStartedAt = energyPromptStartedAtByReq[req.id]
        const movableOffers = allOffers.filter(o => o.status === 'sent' && o.show_requirement_id !== req.id)
        const shouldShowEnergyPrompt = Boolean(
          energySuggestion &&
          showStatus === 'booking' &&
          energyPromptStartedAt &&
          energyPromptClock - energyPromptStartedAt >= EMPTY_STATE_ENERGY_PROMPT_DELAY_MS
        )

        return (
          <div
            key={req.id}
            className={cn(
              spotCardClass,
              'overflow-hidden transition-all',
              isDragOver && 'ring-2 ring-[var(--ev-accent-fill)]'
            )}
            onDragOver={e => handleDragOver(e, req.id)}
            onDragLeave={handleDragLeave}
            onDrop={e => handleDrop(e, req.id)}
          >
            {/* Card header */}
            <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
              <SpotNumber position={index + 1} />
              <RoleIcon roleName={req.role_name} className="size-5 shrink-0 text-[var(--ev-accent-fill)]" />
              <span className="truncate text-base font-bold">{req.role_name}</span>

              <SubmissionsToggle
                showId={showId}
                reqId={req.id}
                open={req.submissions_open}
                pendingCount={pendingByRequirement[req.id] ?? 0}
                disabled={showStatus === 'completed' || showStatus === 'cancelled'}
              />

              {isLocked && (
                <span className={`${STATUS_PILL_CLASS} bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400`}>
                  Locked
                </span>
              )}

              <div className="ml-auto flex shrink-0 items-center gap-2">
                {/* Bookerens håndgrep på plassen. De bor i menyen, så hodet
                    holder seg til de to knappene lineupen tegnes med. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SpotIconButton disabled={isPending} aria-label={`Actions for the ${req.role_name} spot`}>
                      <MoreVertical className="size-4" />
                    </SpotIconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {!isLocked && (
                      <>
                        <DropdownMenuItem
                          onClick={() => {
                            setOpenOfferReqId(req.id)
                            setOpenAddReqId(null)
                            setOpenMoveReqId(null)
                            setOpenInfoReqId(null)
                            setOfferArtistId('')
                          }}
                        >
                          Send offer…
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setOpenAddReqId(req.id)
                            setOpenOfferReqId(null)
                            setOpenMoveReqId(null)
                            setOpenInfoReqId(null)
                            setAddArtistId('')
                          }}
                        >
                          Add comedian…
                        </DropdownMenuItem>
                        {movableOffers.length > 0 && (
                          <DropdownMenuItem
                            onClick={() => {
                              setOpenMoveReqId(req.id)
                              setOpenOfferReqId(null)
                              setOpenAddReqId(null)
                              setOpenInfoReqId(null)
                              setMoveOfferId('')
                            }}
                          >
                            Move an offer here…
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
                    <DropdownMenuItem
                      onClick={() => {
                        setOpenInfoReqId(isInfoOpen ? null : req.id)
                        setOpenAddReqId(null)
                        setOpenOfferReqId(null)
                        setOpenMoveReqId(null)
                      }}
                    >
                      {isInfoOpen ? 'Hide requirements' : 'Show requirements'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Etter showet er lineupen en protokoll: ingen nye plasser. */}
                {!isPastShow && (
                  <SpotIconButton
                    onClick={() => handleDuplicateRequirement(req)}
                    disabled={isPending}
                    aria-label={`Duplicate the ${req.role_name} spot`}
                    title="Duplicate spot"
                  >
                    <Copy className="size-4" />
                  </SpotIconButton>
                )}

                {/* Også når spoten er full: det er nettopp da den ellers ikke
                    er til å bli kvitt. */}
                {!isPastShow && (
                  <SpotIconButton
                    tone="danger"
                    onClick={() => handleDeleteRequirement(req.id, req.role_name, reqSpots.length + reqPending.length)}
                    disabled={isPending}
                    aria-label={`Delete the ${req.role_name} spot`}
                    title="Delete spot"
                  >
                    <Trash2 className="size-4" />
                  </SpotIconButton>
                )}
              </div>
            </div>

            {isInfoOpen && (
              <div className="border-t bg-muted/10 px-4 py-2.5 sm:px-5">
                <div className="flex flex-wrap gap-1.5">
                  {summaryItems.map((item) => (
                    <span key={item} className="rounded-md bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground ring-1 ring-border">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Confirmed spots */}
            {reqSpots.map(spot => {
              const artist = artistMap[spot.artist_id]
              const isSwapping = swapSpotId === spot.id
              const isDraggingThis = dragItem?.type === 'spot' && dragItem.id === spot.id

              return (
                <div key={spot.id}>
                  <div
                    draggable={!isSwapping && !isPending}
                    onDragStart={e => handleSpotDragStart(e, spot.id)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      'flex items-center gap-3 border-t px-4 py-3 transition-opacity sm:gap-4 sm:px-5',
                      isDraggingThis && 'opacity-30',
                      !isSwapping && !isPending && 'cursor-grab active:cursor-grabbing'
                    )}
                  >
                    {/* Avatar */}
                    {artist?.profile_image_url ? (
                      <Image
                        src={artist.profile_image_url}
                        alt=""
                        width={40}
                        height={40}
                        unoptimized={shouldBypassImageOptimization(artist.profile_image_url)}
                        className="size-10 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--ev-accent-fill)]/10 text-sm font-bold text-[var(--ev-accent)]">
                        {(artist?.full_name ?? '?').charAt(0)}
                      </div>
                    )}

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/admin-app/artists/${spot.artist_id}`}
                        className="block truncate text-sm font-semibold underline-offset-2 hover:underline"
                      >
                        {artist?.full_name ?? '—'}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">{artist?.email}</div>
                    </div>

                    {/* Fee */}
                    <div className="hidden w-28 shrink-0 border-l pl-4 sm:block">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Fee</div>
                      <div className="truncate text-sm font-semibold tabular-nums">
                        {spot.fee_amount != null
                          ? formatRequirementCurrency(spot.fee_amount, spot.currency ?? showCurrency)
                          : requirementFee(req, showCurrency)}
                      </div>
                    </div>

                    {/* Status */}
                    <span className={`${STATUS_PILL_CLASS} ${STATUS_COLORS[spot.status] ?? 'bg-muted text-muted-foreground'}`}>
                      {STATUS_LABELS[spot.status] ?? spot.status}
                    </span>

                    <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block" />

                    {/* 3-dot menu */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                          disabled={isPending}
                          aria-label="Actions"
                        >
                          <MoreVertical className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          onClick={() => {
                            setSwapSpotId(isSwapping ? null : spot.id)
                            setSwapArtistId('')
                          }}
                        >
                          Swap comedian
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => handleRemoveSpot(spot.id, 'cancelled')}
                        >
                          Comedian cancelled
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => handleRemoveSpot(spot.id)}
                        >
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Inline swap panel */}
                  {isSwapping && (
                    <div className="flex flex-wrap items-center gap-2 border-t bg-muted/10 px-4 py-3 sm:px-5">
                      <select
                        value={swapArtistId}
                        onChange={e => setSwapArtistId(e.target.value)}
                        disabled={isPending}
                        className="flex-1 min-w-48 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                      >
                        <option value="">Select a new comedian…</option>
                        {selectableArtists
                          .filter(a => a.id !== spot.artist_id)
                          .map(a => (
                            <option key={a.id} value={a.id}>
                              {a.stage_name ?? a.full_name}
                            </option>
                          ))}
                      </select>
                      <button
                        onClick={() => handleSwapArtist(spot.id)}
                        disabled={!swapArtistId || isPending}
                        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50 transition-opacity"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => { setSwapSpotId(null); setSwapArtistId('') }}
                        className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Pending offers (only shown when not locked) */}
            {!isLocked && reqPending.length > 0 && (
              <div>
                {reqPending.map(offer => {
                  const artist = artistMap[offer.artist_id]
                  const isDraggingThis = dragItem?.type === 'offer' && dragItem.id === offer.id
                  return (
                    <div
                      key={offer.id}
                      draggable={!isPending}
                      onDragStart={e => handleOfferDragStart(e, offer.id)}
                      onDragEnd={handleDragEnd}
                      className={cn(
                        'flex items-center gap-3 border-t px-4 py-3 transition-opacity sm:gap-4 sm:px-5',
                        isDraggingThis && 'opacity-30',
                        !isPending && 'cursor-grab active:cursor-grabbing'
                      )}
                    >
                      {artist?.profile_image_url ? (
                        <Image
                          src={artist.profile_image_url}
                          alt=""
                          width={40}
                          height={40}
                          unoptimized={shouldBypassImageOptimization(artist.profile_image_url)}
                          className="size-10 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--ev-accent-fill)]/10 text-sm font-bold text-[var(--ev-accent)]">
                          {(artist?.full_name ?? '?').charAt(0)}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/admin-app/artists/${offer.artist_id}`}
                          className="block truncate text-sm font-semibold underline-offset-2 hover:underline"
                        >
                          {artist?.full_name ?? '—'}
                        </Link>
                        <div className="truncate text-xs text-muted-foreground">{artist?.email}</div>
                      </div>

                      <div className="hidden w-28 shrink-0 border-l pl-4 sm:block">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Fee</div>
                        <div className="truncate text-sm font-semibold tabular-nums">{requirementFee(req, showCurrency)}</div>
                      </div>

                      <span className={`${STATUS_PILL_CLASS} bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400`}>
                        Awaiting reply
                      </span>

                      <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">
                        {offer.sent_at ? new Date(offer.sent_at).toLocaleDateString('en-GB') : '—'}
                      </span>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            disabled={isPending}
                            aria-label="Actions"
                          >
                            <MoreVertical className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => handleApproveOffer(offer.id)}>
                            Approve
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleCancelOffer(offer.id)}
                          >
                            Withdraw
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Empty state */}
            {reqSpots.length === 0 && reqPending.length === 0 && (
              shouldShowEnergyPrompt ? (
                <div className="border-t bg-amber-50/40 px-4 py-4 dark:bg-amber-950/10 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                        No one meets the requirement — open it up to all energy levels?
                      </p>
                      <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
                        {energySuggestion.candidates > 0
                          ? `${energySuggestion.candidates} candidate${energySuggestion.candidates === 1 ? '' : 's'} match the role and gender if energy is set to Any.`
                          : 'Opens up the energy requirement for this spot and starts a new offer round.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenEnergyLevels(req.id)}
                      disabled={isPending}
                      className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                    >
                      Open up energy levels
                    </button>
                  </div>
                </div>
              ) : (
                <p className="px-4 pb-4 text-sm text-muted-foreground sm:pl-[4.25rem] sm:pr-5">
                  {showStatus === 'draft'
                    ? 'Start booking to send offers to artists.'
                    : 'No active offers or confirmed artists yet.'}
                </p>
              )
            )}

            {/* Move pending offer panel */}
            {openMoveReqId === req.id && !isLocked && (
              <div className="flex flex-wrap items-center gap-2 border-t bg-muted/10 px-4 py-3 sm:px-5">
                <select
                  value={moveOfferId}
                  onChange={e => setMoveOfferId(e.target.value)}
                  disabled={isPending}
                  className="flex-1 min-w-48 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                >
                  <option value="">Select a pending offer…</option>
                  {movableOffers.map((offer) => {
                    const artist = artistMap[offer.artist_id]
                    const sourceReq = requirements.find((targetReq) => targetReq.id === offer.show_requirement_id)
                    const sourceLabel = sourceReq ? ` from ${sourceReq.role_name}` : ' without a spot'
                    return (
                      <option key={offer.id} value={offer.id}>
                        {artist?.stage_name ?? artist?.full_name ?? 'Unknown comedian'}{sourceLabel}
                      </option>
                    )
                  })}
                </select>
                <button
                  onClick={() => handleMovePendingOfferToRequirement(moveOfferId, req.id)}
                  disabled={!moveOfferId || isPending}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50 transition-opacity"
                >
                  Move here
                </button>
                <button
                  onClick={() => { setOpenMoveReqId(null); setMoveOfferId('') }}
                  className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Send offer panel */}
            {openOfferReqId === req.id && !isLocked && (
              <div className="space-y-2 border-t bg-muted/10 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={offerArtistId}
                    onChange={e => setOfferArtistId(e.target.value)}
                    disabled={isPending}
                    className="flex-1 min-w-48 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                  >
                    <option value="">Select comedian…</option>
                    {offerableArtists.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.stage_name ?? a.full_name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleSendOffer(req.id)}
                    disabled={!offerArtistId || isPending}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50 transition-opacity"
                  >
                    Send offer
                  </button>
                  <button
                    onClick={() => { setOpenOfferReqId(null); setOfferArtistId('') }}
                    className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  The comedian gets the offer by email and has to accept before the spot is filled.
                </p>
              </div>
            )}

            {/* Add artist panel */}
            {openAddReqId === req.id && !isLocked && (
              <div className="flex flex-wrap items-center gap-2 border-t bg-muted/10 px-4 py-3 sm:px-5">
                <select
                  value={addArtistId}
                  onChange={e => setAddArtistId(e.target.value)}
                  disabled={isPending}
                  className="flex-1 min-w-48 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                >
                  <option value="">Select comedian…</option>
                  {selectableArtists.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.stage_name ?? a.full_name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => handleAddArtist(req.id)}
                  disabled={!addArtistId || isPending}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50 transition-opacity"
                >
                  Add
                </button>
                <button
                  onClick={() => { setOpenAddReqId(null); setAddArtistId('') }}
                  className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* Unassigned offers */}
      {unassignedOffers.length > 0 && (
        <div className={cn(spotCardClass, 'overflow-hidden')}>
          <div className="px-4 py-3 border-b bg-muted/20 flex items-center gap-2">
            <span className="font-semibold text-sm">Other offers</span>
            <span className="text-xs text-muted-foreground">Not linked to a requirement</span>
          </div>
          <div className="divide-y">
            {unassignedOffers.map(o => {
              const artist = artistMap[o.artist_id]
              return (
                <div key={o.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 text-sm font-medium">{artist?.full_name ?? '—'}</div>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                    Awaiting reply
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {o.sent_at ? new Date(o.sent_at).toLocaleDateString('en-GB') : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {requirements.length === 0 && (
        <div className="rounded-2xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          No requirements defined yet.
          <div className="mt-3">
            <Link
              href={`/admin-app/shows/${showId}?tab=lineup`}
              className="text-primary underline-offset-2 hover:underline text-sm"
            >
              Set up booking requirements
            </Link>
          </div>
        </div>
      )}

      {/* Showet publiserer seg ikke selv. Når siste plass er bekreftet får
          klubben en e-post, og publiserer herfra når event-siden er klar.
          Vil klubben kjøre kortere lineup, sletter bookeren plassen — da er
          lineupen full. */}
      {requirements.length > 0 && !allSlotsFilled && ['draft', 'booking', 'fullbooked'].includes(showStatus) && (
        <div className={cn(spotCardClass, 'px-4 py-4 sm:px-5')}>
          <p className="text-sm text-muted-foreground">
            {filledSlots} of {totalSlots} spots are filled. You get an email as soon as every spot has a
            confirmed comedian, and publish the show yourself when the event page is ready. To run a
            shorter lineup, delete a spot — then the lineup is full.
          </p>
        </div>
      )}

      {/* Publisert, og så ble en plass ledig igjen — et frafall. Showet blir
          stående publisert: billettene er solgt, og motoren fyller plassen. */}
      {requirements.length > 0 && !allSlotsFilled && showStatus === 'published' && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50/50 p-5 dark:bg-emerald-950/20">
          <h3 className="font-bold text-emerald-900 dark:text-emerald-300">A spot has opened up again</h3>
          <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-0.5">
            {filledSlots} of {totalSlots} spots are filled. The event page stays live, and booking keeps running until the spot is filled again.{' '}
            <Link href={`/admin-app/shows/${showId}?tab=marketing`} className="underline underline-offset-2">
              Regenerate the poster
            </Link>{' '}
            once the lineup has changed.
          </p>
        </div>
      )}

      {/* Full lineup, ikke publisert: klubben trykker selv. */}
      {allSlotsFilled && ['draft', 'booking', 'fullbooked'].includes(showStatus) && (
        <div className="rounded-2xl border-2 border-purple-300 bg-purple-50/50 p-5 dark:bg-purple-950/20">
          <h3 className="font-bold text-purple-900 dark:text-purple-300">The lineup is ready! 🎉</h3>
          <p className="text-sm text-purple-700 dark:text-purple-400 mt-0.5">
            Every spot is filled. The show is not published yet — nothing goes live and no tickets are sold
            until you publish it.
            {publishReadiness.some((item) => !item.done) && (
              <> Still missing: {publishReadiness.filter((item) => !item.done).map((item) => item.label.toLowerCase()).join(', ')}.</>
            )}
          </p>
          <PublishShowDialog showId={showId} showTitle={showTitle} readiness={publishReadiness} className="mt-3" />
        </div>
      )}
    </div>
  )
}
