'use client'

import { useEffect, useState, useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Info } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { shouldBypassImageOptimization } from '@/lib/utils'
import {
  removeSpotAndReopenAction,
  moveSpotAction,
  movePendingOfferAction,
  swapArtistAction,
  addArtistToRequirementAction,
  sendOfferToArtistAction,
  publishLineupAction,
  cancelOfferAction,
  updateOfferStatusAction,
  openRequirementEnergyLevelsAction,
} from '../actions'
import type { RequirementCompensationType, RequirementEnergy, RequirementGender } from '@/types/database'

type Artist = {
  id: string
  full_name: string
  stage_name: string | null
  email: string
  profile_image_url: string | null
  admin_score: number | null
  admin_energy_level: string | null
}

type SelectableArtist = {
  id: string
  full_name: string
  stage_name: string | null
  email: string
  admin_score: number | null
  admin_energy_level: string | null
}

type Requirement = {
  id: string
  role_name: string
  quantity: number
  lineup_position: number
  min_score: number | null
  energy_level: RequirementEnergy
  required_gender: RequirementGender
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
  confirmed: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-sky-100 text-sky-700',
  paid: 'bg-purple-100 text-purple-700',
}

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
  male: 'Male',
  female: 'Female',
}

function formatEditableNumber(value: number | null) {
  if (value == null) return ''
  return Number.isInteger(value) ? String(value) : String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.0$/, '')
}

function formatRequirementCurrency(minorAmount: number | null, currency: string) {
  if (minorAmount == null) return 'Not set'
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(minorAmount / 100)
}

function requirementSummary(requirement: Requirement, currency: string) {
  const fee = requirement.compensation_type === 'fixed'
    ? formatRequirementCurrency(requirement.compensation_amount, currency)
    : requirement.compensation_type === 'percent'
      ? requirement.compensation_percent == null ? 'Not set' : `${formatEditableNumber(requirement.compensation_percent)}%`
      : 'Not set'

  return [
    `Score ${requirement.min_score ?? 'any'}`,
    `Energy ${ENERGY_LABELS[requirement.energy_level] ?? requirement.energy_level}`,
    `Gender ${GENDER_LABELS[requirement.required_gender] ?? requirement.required_gender}`,
    fee,
  ]
}

export function LineupTab({
  showId,
  showStatus,
  showCurrency,
  requirements,
  confirmedSpots,
  allOffers,
  artistMap,
  selectableArtists,
  energyRelaxationSuggestions,
  allSlotsFilled,
}: {
  showId: string
  showStatus: string
  showCurrency: string
  requirements: Requirement[]
  confirmedSpots: ConfirmedSpot[]
  allOffers: BookingOffer[]
  artistMap: Record<string, Artist>
  selectableArtists: SelectableArtist[]
  energyRelaxationSuggestions: Record<string, { candidates: number }>
  allSlotsFilled: boolean
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

  function handleRemoveSpot(spotId: string) {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('spot_id', spotId)
      fd.set('show_id', showId)
      try {
        await removeSpotAndReopenAction(fd)
        toast.success('Artist removed. A new offer round starts automatically.')
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

  function handlePublishLineup() {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('show_id', showId)
      try {
        await publishLineupAction(fd)
        toast.success('The lineup is published.')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not publish the lineup')
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

  return (
    <div className="space-y-5">
      {requirements.map(req => {
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
            className={`rounded-xl border bg-card overflow-hidden transition-all ${isDragOver ? 'ring-2 ring-primary border-primary' : ''}`}
            onDragOver={e => handleDragOver(e, req.id)}
            onDragLeave={handleDragLeave}
            onDrop={e => handleDrop(e, req.id)}
          >
            {/* Card header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className={`size-2 rounded-full shrink-0 ${isLocked ? 'bg-emerald-500' : reqPending.length > 0 ? 'bg-amber-400' : 'bg-muted-foreground/30'}`} />
                <span className="font-semibold text-sm">{req.role_name}</span>
                {isLocked && (
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Locked</span>
                )}
                {!isLocked && reqPending.length > 0 && (
                  <span className="text-xs text-amber-600 font-medium">
                    {reqPending.length} awaiting reply
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!isLocked && (
                  <>
                    <button
                      onClick={() => {
                        setOpenOfferReqId(openOfferReqId === req.id ? null : req.id)
                        setOpenAddReqId(null)
                        setOpenMoveReqId(null)
                        setOpenInfoReqId(null)
                        setOfferArtistId('')
                      }}
                      disabled={isPending}
                      className="text-xs font-medium px-2.5 py-1 rounded-md border hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      + Send offer
                    </button>
                    <button
                      onClick={() => {
                        setOpenAddReqId(openAddReqId === req.id ? null : req.id)
                        setOpenOfferReqId(null)
                        setOpenMoveReqId(null)
                        setOpenInfoReqId(null)
                        setAddArtistId('')
                      }}
                      disabled={isPending}
                      className="text-xs font-medium px-2.5 py-1 rounded-md border hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      + Add
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setOpenInfoReqId(isInfoOpen ? null : req.id)
                    setOpenAddReqId(null)
                    setOpenOfferReqId(null)
                    setOpenMoveReqId(null)
                  }}
                  className="inline-flex size-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Show requirement info"
                  title="Requirement info"
                >
                  <Info className="size-3.5" />
                </button>
              </div>
            </div>

            {isInfoOpen && (
              <div className="border-b bg-muted/10 px-4 py-2.5">
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
                    className={`flex items-center gap-3 px-4 py-3 border-l-2 border-l-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/10 transition-opacity ${isDraggingThis ? 'opacity-30' : ''} ${!isSwapping && !isPending ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                    {/* Avatar */}
                    {artist?.profile_image_url ? (
                      <Image
                        src={artist.profile_image_url}
                        alt=""
                        width={36}
                        height={36}
                        unoptimized={shouldBypassImageOptimization(artist.profile_image_url)}
                        className="size-9 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="size-9 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center text-sm font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
                        {(artist?.full_name ?? '?').charAt(0)}
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin-app/artists/${spot.artist_id}`}
                          className="font-semibold text-sm truncate hover:underline underline-offset-2"
                        >
                          {artist?.full_name ?? '—'}
                        </Link>
                        {artist?.admin_score != null && (
                          <span className="text-xs text-muted-foreground shrink-0">⭐ {artist.admin_score}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{artist?.email}</div>
                    </div>

                    {/* Status */}
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[spot.status] ?? 'bg-muted text-muted-foreground'}`}>
                      {spot.status}
                    </span>

                    {/* Fee */}
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums min-w-[60px] text-right">
                      {spot.fee_amount ? `${spot.fee_amount / 100} ${spot.currency ?? showCurrency}` : '—'}
                    </span>

                    {/* 3-dot menu */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="shrink-0 rounded p-1.5 hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
                          disabled={isPending}
                          aria-label="Actions"
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                            <circle cx="8" cy="3" r="1.5" />
                            <circle cx="8" cy="8" r="1.5" />
                            <circle cx="8" cy="13" r="1.5" />
                          </svg>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
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
                          onClick={() => handleRemoveSpot(spot.id)}
                        >
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Inline swap panel */}
                  {isSwapping && (
                    <div className="border-t bg-muted/10 px-4 py-3 flex flex-wrap items-center gap-2">
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
                              {a.stage_name ?? a.full_name}{a.admin_score != null ? ` · ⭐${a.admin_score}` : ''}
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
              <div className="divide-y">
                {reqPending.map(offer => {
                  const artist = artistMap[offer.artist_id]
                  const isDraggingThis = dragItem?.type === 'offer' && dragItem.id === offer.id
                  return (
                    <div
                      key={offer.id}
                      draggable={!isPending}
                      onDragStart={e => handleOfferDragStart(e, offer.id)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-3 px-4 py-2.5 border-l-2 border-l-amber-400 bg-amber-50/30 dark:bg-amber-950/10 transition-opacity ${isDraggingThis ? 'opacity-30' : ''} ${!isPending ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    >
                      {artist?.profile_image_url ? (
                        <Image
                          src={artist.profile_image_url}
                          alt=""
                          width={36}
                          height={36}
                          unoptimized={shouldBypassImageOptimization(artist.profile_image_url)}
                          className="size-9 rounded-full object-cover shrink-0 opacity-70"
                        />
                      ) : (
                        <div className="size-9 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center text-sm font-bold text-amber-600 dark:text-amber-300 shrink-0">
                          {(artist?.full_name ?? '?').charAt(0)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/admin-app/artists/${offer.artist_id}`}
                            className="text-sm truncate text-muted-foreground hover:underline underline-offset-2"
                          >
                            {artist?.full_name ?? '—'}
                          </Link>
                          {artist?.admin_score != null && (
                            <span className="text-xs text-muted-foreground/60 shrink-0">⭐ {artist.admin_score}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground/60 truncate">{artist?.email}</div>
                      </div>
                      <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                        Awaiting reply
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {offer.sent_at ? new Date(offer.sent_at).toLocaleDateString('en-GB') : '—'}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="shrink-0 rounded p-1.5 hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
                            disabled={isPending}
                            aria-label="Actions"
                          >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                              <circle cx="8" cy="3" r="1.5" />
                              <circle cx="8" cy="8" r="1.5" />
                              <circle cx="8" cy="13" r="1.5" />
                            </svg>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
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
                <div className="border-l-2 border-l-amber-400 bg-amber-50/40 px-4 py-4 dark:bg-amber-950/10">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                        No one meets the requirement — open it up to all energy levels?
                      </p>
                      <p className="text-xs text-amber-700/80 dark:text-amber-300/80">
                        {energySuggestion.candidates > 0
                          ? `${energySuggestion.candidates} candidate${energySuggestion.candidates === 1 ? '' : 's'} match the role, gender and score if energy is set to Any.`
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
                <p className="px-4 py-5 text-sm text-muted-foreground">
                  {showStatus === 'draft'
                    ? 'Start booking to send offers to artists.'
                    : 'No active offers or confirmed artists yet.'}
                </p>
              )
            )}

            {/* Move pending offer panel */}
            {openMoveReqId === req.id && !isLocked && (
              <div className="border-t bg-muted/10 px-4 py-3 flex flex-wrap items-center gap-2">
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
              <div className="border-t bg-muted/10 px-4 py-3 space-y-2">
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
                        {a.stage_name ?? a.full_name}{a.admin_score != null ? ` · ⭐${a.admin_score}` : ''}
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
              <div className="border-t bg-muted/10 px-4 py-3 flex flex-wrap items-center gap-2">
                <select
                  value={addArtistId}
                  onChange={e => setAddArtistId(e.target.value)}
                  disabled={isPending}
                  className="flex-1 min-w-48 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                >
                  <option value="">Select comedian…</option>
                  {selectableArtists.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.stage_name ?? a.full_name}{a.admin_score != null ? ` · ⭐${a.admin_score}` : ''}
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
        <div className="rounded-xl border bg-card overflow-hidden">
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
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground text-sm">
          No requirements defined yet.
          <div className="mt-3">
            <Link
              href={`/admin-app/shows/${showId}?tab=requirements`}
              className="text-primary underline-offset-2 hover:underline text-sm"
            >
              Set up booking requirements
            </Link>
          </div>
        </div>
      )}

      {/* Manual publish — booker decides when the lineup is good enough */}
      {requirements.length > 0 && !allSlotsFilled && ['draft', 'booking', 'fullbooked'].includes(showStatus) && (
        <div className="rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <h3 className="font-semibold text-sm">Publish lineup now</h3>
              <p className="text-sm text-muted-foreground">
                {filledSlots === 0
                  ? 'At least one comedian has to accept before the lineup can be published.'
                  : `${filledSlots} of ${totalSlots} spots are filled. Publish when you are happy — pending offers keep running, and comedians who accept later are added to the lineup.`}
              </p>
            </div>
            <button
              type="button"
              onClick={handlePublishLineup}
              disabled={isPending || filledSlots === 0}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Publish lineup
            </button>
          </div>
        </div>
      )}

      {/* Published with open slots */}
      {requirements.length > 0 && !allSlotsFilled && showStatus === 'published' && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20 p-5">
          <h3 className="font-bold text-emerald-900 dark:text-emerald-300">Published with open spots</h3>
          <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-0.5">
            {filledSlots} of {totalSlots} spots are filled. The event page is live, and the lineup updates as more comedians accept.{' '}
            <Link href={`/admin-app/shows/${showId}?tab=marketing`} className="underline underline-offset-2">
              Regenerate the poster
            </Link>{' '}
            once the lineup has changed.
          </p>
        </div>
      )}

      {/* All-filled celebration */}
      {allSlotsFilled && showStatus === 'booking' && (
        <div className="rounded-xl border-2 border-purple-300 bg-purple-50/50 dark:bg-purple-950/20 p-5">
          <h3 className="font-bold text-purple-900 dark:text-purple-300">The lineup is ready! 🎉</h3>
          <p className="text-sm text-purple-700 dark:text-purple-400 mt-0.5">
            Every spot is filled. The system generates the lineup poster, publishes the event page and starts marketing automatically.
          </p>
        </div>
      )}
    </div>
  )
}
