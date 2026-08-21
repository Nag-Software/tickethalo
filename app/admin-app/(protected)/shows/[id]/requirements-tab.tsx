'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToastActionForm } from '@/components/toast-action-form'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  addRequirementAction,
  reorderRequirementsAction,
  updateRequirementAction,
  deleteRequirementAction,
  startBookingAction,
} from '../actions'
import { ARTIST_ROLE_LABEL_OPTIONS, canonicalRoleLabel } from '@/lib/artist-roles'
import type { RequirementCompensationType, RequirementEnergy, RequirementGender } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type Requirement = {
  id: string
  lineup_position: number
  role_name: string
  min_score: number | null
  energy_level: RequirementEnergy
  required_gender: RequirementGender
  compensation_type: RequirementCompensationType | null
  compensation_amount: number | null
  compensation_percent: number | null
}

type ReqState = {
  lineup_position: number
  role_name: string
  min_score: string
  energy_level: RequirementEnergy
  required_gender: RequirementGender
  compensation_type: RequirementCompensationType | ''
  compensation_amount: string
  compensation_percent: string
}

type WizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6

type WizardState = ReqState & { step: WizardStep }

type DragEdge = 'top' | 'bottom'

type CompensationIssue = {
  tone: 'destructive' | 'warning'
  message: string
}

type Props = {
  showId: string
  showStatus: string
  showCurrency: string
  requirements: Requirement[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WIZARD_INITIAL: WizardState = {
  step: 0,
  lineup_position: 0,
  role_name: '',
  min_score: '',
  energy_level: 'any',
  required_gender: 'any',
  compensation_type: '',
  compensation_amount: '',
  compensation_percent: '',
}

const SCORE_OPTIONS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']

const ENERGY_OPTIONS: { value: RequirementEnergy; label: string; icon: string }[] = [
  { value: 'any', label: 'Alle', icon: '∞' },
  { value: 'high', label: 'Høy', icon: '⚡' },
  { value: 'low', label: 'Lav', icon: '🌊' },
  { value: 'uncertain', label: 'Ukjent', icon: '?' },
]

const GENDER_OPTIONS: { value: RequirementGender; label: string; icon: string }[] = [
  { value: 'any', label: 'Alle', icon: '⚡' },
  { value: 'male', label: 'Mann', icon: '♂' },
  { value: 'female', label: 'Dame', icon: '♀' },
]

const ENERGY_LABELS: Record<RequirementEnergy, string> = {
  any: 'Alle energinivåer',
  high: 'Høy energi',
  low: 'Lav energi',
  uncertain: 'Ukjent energi',
}

const GENDER_LABELS: Record<RequirementGender, string> = {
  any: 'Alle kjønn',
  male: 'Mann',
  female: 'Dame',
}

const COMPENSATION_TYPE_OPTIONS: Array<{
  value: RequirementCompensationType | ''
  label: string
  hint: string
  accent: string
}> = [
  { value: 'fixed', label: 'Fast beløp', hint: 'Sett et konkret honorar per komiker.', accent: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20' },
  { value: 'percent', label: 'Prosent', hint: 'Fordel en andel av totalen mellom komikerne.', accent: 'bg-sky-500/10 text-sky-700 ring-sky-500/20' },
  { value: '', label: 'Sett senere', hint: 'La plassen stå uten honorar inntil videre.', accent: 'bg-muted text-muted-foreground ring-border' },
]

const REQUIREMENT_DRAFTS_STORAGE_PREFIX = 'show-requirement-drafts:'

// ─── Helper ───────────────────────────────────────────────────────────────────

function toPlainNumber(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function formatEditableNumber(value: number | null) {
  if (value == null) return ''
  return Number.isInteger(value) ? String(value) : String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.0$/, '')
}

function formatCurrency(minorAmount: number | null, currency: string) {
  if (minorAmount == null) return 'Ikke satt'
  return new Intl.NumberFormat('nb-NO', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(minorAmount / 100)
}

function formatPercent(value: number) {
  return new Intl.NumberFormat('nb-NO', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2,
  }).format(value)
}

function stateFromRequirement(requirement: Requirement): ReqState {
  return {
    lineup_position: requirement.lineup_position,
    role_name: canonicalRoleLabel(requirement.role_name) ?? ARTIST_ROLE_LABEL_OPTIONS[0],
    min_score: requirement.min_score != null ? String(requirement.min_score) : '',
    energy_level: requirement.energy_level,
    required_gender: requirement.required_gender,
    compensation_type: requirement.compensation_type ?? '',
    compensation_amount: requirement.compensation_amount != null ? formatEditableNumber(requirement.compensation_amount / 100) : '',
    compensation_percent: requirement.compensation_percent != null ? formatEditableNumber(requirement.compensation_percent) : '',
  }
}

function buildFormData(showId: string, reqId: string, state: ReqState): FormData {
  const fd = new FormData()
  fd.set('show_id', showId)
  fd.set('req_id', reqId)
  fd.set('lineup_position', String(state.lineup_position))
  fd.set('role_name', state.role_name)
  fd.set('quantity', '1')
  fd.set('min_score', state.min_score)
  fd.set('energy_level', state.energy_level)
  fd.set('required_gender', state.required_gender)
  fd.set('compensation_type', state.compensation_type)
  fd.set('compensation_amount', state.compensation_amount)
  fd.set('compensation_percent', state.compensation_percent)
  return fd
}

function isSameReqState(left: ReqState, right: ReqState) {
  return left.lineup_position === right.lineup_position
    && left.role_name === right.role_name
    && left.min_score === right.min_score
    && left.energy_level === right.energy_level
    && left.required_gender === right.required_gender
    && left.compensation_type === right.compensation_type
    && left.compensation_amount === right.compensation_amount
    && left.compensation_percent === right.compensation_percent
}

function loadRequirementDrafts(showId: string) {
  if (typeof window === 'undefined') {
    return {} as Record<string, ReqState>
  }

  try {
    const raw = window.localStorage.getItem(`${REQUIREMENT_DRAFTS_STORAGE_PREFIX}${showId}`)
    if (!raw) {
      return {} as Record<string, ReqState>
    }

    const parsed = JSON.parse(raw) as Record<string, ReqState>
    return parsed ?? {}
  } catch {
    return {} as Record<string, ReqState>
  }
}

function saveRequirementDrafts(showId: string, drafts: Record<string, ReqState>) {
  if (typeof window === 'undefined') {
    return
  }

  const key = `${REQUIREMENT_DRAFTS_STORAGE_PREFIX}${showId}`
  if (Object.keys(drafts).length === 0) {
    window.localStorage.removeItem(key)
    return
  }

  window.localStorage.setItem(key, JSON.stringify(drafts))
}

function totalPercentAllocation(
  ids: string[],
  states: Record<string, ReqState>,
  override?: { id: string; state: ReqState }
) {
  return ids.reduce((sum, id) => {
    const state = override?.id === id ? override.state : states[id]
    if (!state || state.compensation_type !== 'percent') {
      return sum
    }
    return sum + (toPlainNumber(state.compensation_percent) ?? 0)
  }, 0)
}

function blockingCompensationIssue(
  ids: string[],
  states: Record<string, ReqState>,
  id: string,
  nextState: ReqState
) {
  if (nextState.compensation_type === 'fixed') {
    const amount = toPlainNumber(nextState.compensation_amount)
    if (amount != null && amount < 0) {
      return 'Beløpet må være 0 eller høyere.'
    }
    return null
  }

  if (nextState.compensation_type === 'percent') {
    const percent = toPlainNumber(nextState.compensation_percent)
    if (percent != null && (percent < 0 || percent > 100)) {
      return 'Prosent må være mellom 0 og 100.'
    }

    const projectedTotal = totalPercentAllocation(ids, states, { id, state: nextState })
    if (projectedTotal > 100.0001) {
      return 'Total prosent kan ikke overstige 100%.'
    }
  }

  return null
}

function compensationIssue(
  ids: string[],
  states: Record<string, ReqState>,
  id: string,
  state: ReqState
): CompensationIssue | null {
  const blockingIssue = blockingCompensationIssue(ids, states, id, state)
  if (blockingIssue) {
    return { tone: 'destructive', message: blockingIssue }
  }

  if (state.compensation_type === '') {
    return { tone: 'warning', message: 'Velg honorarmodell' }
  }

  if (state.compensation_type === 'fixed' && toPlainNumber(state.compensation_amount) == null) {
    return { tone: 'warning', message: 'Mangler fast beløp' }
  }

  if (state.compensation_type === 'percent' && toPlainNumber(state.compensation_percent) == null) {
    return { tone: 'warning', message: 'Mangler prosent' }
  }

  return null
}

function compensationSummary(state: ReqState, currency: string) {
  if (state.compensation_type === 'fixed') {
    const amount = toPlainNumber(state.compensation_amount)
    return amount == null ? 'Fast beløp mangler' : formatCurrency(Math.round(amount * 100), currency)
  }

  if (state.compensation_type === 'percent') {
    const percent = toPlainNumber(state.compensation_percent)
    return percent == null ? 'Prosent mangler' : `${formatPercent(percent)} %`
  }

  return 'Ikke satt'
}

function moveRequirementId(ids: string[], draggedId: string, targetId: string, edge: DragEdge) {
  if (draggedId === targetId) {
    return ids
  }

  const next = ids.filter((id) => id !== draggedId)
  const targetIndex = next.indexOf(targetId)

  if (targetIndex === -1) {
    return ids
  }

  next.splice(edge === 'top' ? targetIndex : targetIndex + 1, 0, draggedId)
  return next
}

// ─── RequirementsTab ──────────────────────────────────────────────────────────

export function RequirementsTab({ showId, showStatus, showCurrency, requirements }: Props) {
  const router = useRouter()

  const [wizard, setWizard] = React.useState<WizardState>(WIZARD_INITIAL)
  const [isAdding, startAdding] = React.useTransition()
  const [isReordering, startReordering] = React.useTransition()

  const sortedRequirements = [...requirements].sort(
    (left, right) => left.lineup_position - right.lineup_position || left.role_name.localeCompare(right.role_name)
  )

  const [reqStates, setReqStates] = React.useState<Record<string, ReqState>>(
    () => Object.fromEntries(sortedRequirements.map((requirement) => [requirement.id, stateFromRequirement(requirement)]))
  )
  const [orderedIds, setOrderedIds] = React.useState<string[]>(() => sortedRequirements.map((requirement) => requirement.id))
  const [dirtyIds, setDirtyIds] = React.useState<Set<string>>(new Set())
  const [savingIds, setSavingIds] = React.useState<Set<string>>(new Set())
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [dropTarget, setDropTarget] = React.useState<{ id: string; edge: DragEdge } | null>(null)
  const debounceTimers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const reqStatesRef = React.useRef(reqStates)

  React.useEffect(() => {
    reqStatesRef.current = reqStates
  }, [reqStates])

  React.useEffect(() => {
    const timers = debounceTimers.current
    return () => {
      Object.values(timers).forEach((timer) => clearTimeout(timer))
    }
  }, [])

  React.useEffect(() => {
    const cachedDrafts = loadRequirementDrafts(showId)
    const validDrafts = Object.fromEntries(
      Object.entries(cachedDrafts).filter(([id]) => sortedRequirements.some((requirement) => requirement.id === id))
    )

    if (Object.keys(validDrafts).length === 0) {
      saveRequirementDrafts(showId, {})
      return
    }

    const mergedStates = {
      ...Object.fromEntries(sortedRequirements.map((requirement) => [requirement.id, stateFromRequirement(requirement)])),
      ...validDrafts,
    }

    setReqStates(mergedStates)
    setDirtyIds(new Set(Object.keys(validDrafts)))

    for (const [id, state] of Object.entries(validDrafts)) {
      const blockingIssue = blockingCompensationIssue(orderedIds, mergedStates, id, state)
      if (!blockingIssue) {
        debounceTimers.current[id] = setTimeout(() => {
          delete debounceTimers.current[id]
          persistReq(id, state)
        }, 150)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showId])

  React.useEffect(() => {
    const drafts = Object.fromEntries(
      [...dirtyIds]
        .map((id) => [id, reqStates[id]] as const)
        .filter((entry): entry is [string, ReqState] => Boolean(entry[1]))
    )
    saveRequirementDrafts(showId, drafts)
  }, [dirtyIds, reqStates, showId])

  // ── Autosave logic ──────────────────────────────────────────────────────────

  const persistReq = React.useCallback(
    (id: string, state: ReqState) => {
      setSavingIds((prev) => new Set([...prev, id]))
      updateRequirementAction(buildFormData(showId, id, state))
        .then(() => {
          setSavingIds((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
          setDirtyIds((prev) => {
            const latestState = reqStatesRef.current[id]
            if (!latestState || !isSameReqState(latestState, state) || !prev.has(id)) {
              return prev
            }

            const next = new Set(prev)
            next.delete(id)
            return next
          })
        })
        .catch((err: unknown) => {
          setSavingIds((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
          toast.error((err as Error)?.message ?? 'Lagring feilet')
        })
    },
    [showId]
  )

  const scheduleAutosave = React.useCallback(
    (id: string, state: ReqState) => {
      clearTimeout(debounceTimers.current[id])
      debounceTimers.current[id] = setTimeout(() => {
        delete debounceTimers.current[id]
        persistReq(id, state)
      }, 600)
    },
    [persistReq]
  )

  const flushAutosave = React.useCallback(
    (id: string) => {
      const current = reqStatesRef.current[id]
      if (!current) return

      const blockingIssue = blockingCompensationIssue(orderedIds, reqStatesRef.current, id, current)
      if (blockingIssue) return

      clearTimeout(debounceTimers.current[id])
      delete debounceTimers.current[id]
      persistReq(id, current)
    },
    [orderedIds, persistReq]
  )

  function updateField(id: string, field: keyof ReqState, value: string) {
    const current = reqStates[id]
    if (!current) return

    const next = { ...current, [field]: value } as ReqState
    setReqStates((prev) => ({ ...prev, [id]: next }))
    setDirtyIds((prev) => new Set([...prev, id]))

    const blockingIssue = blockingCompensationIssue(orderedIds, reqStates, id, next)
    if (blockingIssue) {
      clearTimeout(debounceTimers.current[id])
      delete debounceTimers.current[id]
      return
    }

    if (field === 'role_name' || field === 'compensation_amount' || field === 'compensation_percent') {
      scheduleAutosave(id, next)
    } else {
      clearTimeout(debounceTimers.current[id])
      persistReq(id, next)
    }
  }

  function updateLineupPositions(nextOrderedIds: string[]) {
    setReqStates((prev) => {
      const next = { ...prev }
      nextOrderedIds.forEach((id, index) => {
        const current = next[id]
        if (current) {
          next[id] = { ...current, lineup_position: index + 1 }
        }
      })
      return next
    })
  }

  function saveOrder(nextOrderedIds: string[], previousOrderedIds: string[]) {
    updateLineupPositions(nextOrderedIds)
    setOrderedIds(nextOrderedIds)

    startReordering(async () => {
      try {
        const fd = new FormData()
        fd.set('show_id', showId)
        fd.set('ordered_ids', JSON.stringify(nextOrderedIds))
        await reorderRequirementsAction(fd)
        router.refresh()
      } catch (err: unknown) {
        updateLineupPositions(previousOrderedIds)
        setOrderedIds(previousOrderedIds)
        toast.error((err as Error)?.message ?? 'Kunne ikke lagre ny rekkefølge')
      }
    })
  }

  function handleDragStart(id: string, event: React.DragEvent<HTMLDivElement>) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
    setDraggingId(id)
  }

  function handleDragOver(id: string, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const edge: DragEdge = event.clientY < bounds.top + bounds.height / 2 ? 'top' : 'bottom'
    setDropTarget({ id, edge })
  }

  function handleDrop(targetId: string, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()

    const draggedId = draggingId ?? event.dataTransfer.getData('text/plain')
    if (!draggedId) {
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const edge: DragEdge = event.clientY < bounds.top + bounds.height / 2 ? 'top' : 'bottom'
    const previousOrderedIds = orderedIds
    const nextOrderedIds = moveRequirementId(previousOrderedIds, draggedId, targetId, edge)

    setDraggingId(null)
    setDropTarget(null)

    if (nextOrderedIds.join('|') === previousOrderedIds.join('|')) {
      return
    }

    saveOrder(nextOrderedIds, previousOrderedIds)
  }

  // ── Wizard submit ───────────────────────────────────────────────────────────

  function submitDefault() {
    const fd = new FormData()

    fd.set('show_id', showId)
    fd.set('role_name', "Stand-up")
    fd.set('quantity', '1')
    fd.set('min_score', "any")
    fd.set('energy_level', "any")
    fd.set('required_gender', "any")
    fd.set('compensation_type', "")
    fd.set('compensation_amount', "")
    fd.set('compensation_percent', "")

    startAdding(async () => {
      try {
        await addRequirementAction(fd)
        setWizard(WIZARD_INITIAL)
        toast.success('Krav lagt til')
        router.refresh()
      } catch (err: unknown) {
        toast.error((err as Error)?.message ?? 'Feil ved lagring')
      }
    })
  }

  function submitWizard() {
    const fd = new FormData()
    fd.set('show_id', showId)
    fd.set('role_name', wizard.role_name)
    fd.set('quantity', '1')
    fd.set('min_score', wizard.min_score)
    fd.set('energy_level', wizard.energy_level)
    fd.set('required_gender', wizard.required_gender)
    fd.set('compensation_type', wizard.compensation_type)
    fd.set('compensation_amount', wizard.compensation_amount)
    fd.set('compensation_percent', wizard.compensation_percent)
    startAdding(async () => {
      try {
        await addRequirementAction(fd)
        setWizard(WIZARD_INITIAL)
        toast.success('Krav lagt til')
        router.refresh()
      } catch (err: unknown) {
        toast.error((err as Error)?.message ?? 'Feil ved lagring')
      }
    })
  }

  const canEdit = ['draft', 'booking', 'fullbooked'].includes(showStatus)
  const requirementMap = Object.fromEntries(sortedRequirements.map((requirement) => [requirement.id, requirement]))
  const orderedRequirements = orderedIds
    .map((id) => requirementMap[id])
    .filter((requirement): requirement is Requirement => Boolean(requirement))
  const totalPercent = totalPercentAllocation(orderedIds, reqStates)
  const fixedCount = orderedRequirements.filter((requirement) => reqStates[requirement.id]?.compensation_type === 'fixed').length
  const percentCount = orderedRequirements.filter((requirement) => reqStates[requirement.id]?.compensation_type === 'percent').length
  const issueCount = orderedRequirements.filter((requirement) => {
    const state = reqStates[requirement.id]
    return state ? Boolean(compensationIssue(orderedIds, reqStates, requirement.id, state)) : false
  }).length

  // ── Booking blockers ────────────────────────────────────────────────────
  const missingRoleName = orderedRequirements.filter((req) => !(reqStates[req.id]?.role_name ?? req.role_name).trim()).length
  const missingCompType = orderedRequirements.filter((req) => !(reqStates[req.id]?.compensation_type ?? req.compensation_type ?? '')).length
  const missingAmount = orderedRequirements.filter((req) => {
    const state = reqStates[req.id]
    if (!state) return false
    if (state.compensation_type === 'fixed' && !state.compensation_amount.trim()) return true
    if (state.compensation_type === 'percent' && !state.compensation_percent.trim()) return true
    return false
  }).length
  const blockingIssueCount = orderedRequirements.filter((req) => {
    const state = reqStates[req.id]
    return state ? compensationIssue(orderedIds, reqStates, req.id, state)?.tone === 'destructive' : false
  }).length

  const bookingBlockers: string[] = []
  if (orderedRequirements.length === 0) bookingBlockers.push('Legg til minst én lineup-plass')
  if (missingRoleName > 0) bookingBlockers.push(`${missingRoleName} plass${missingRoleName > 1 ? 'er' : ''} mangler rollenavn`)
  if (missingCompType > 0) bookingBlockers.push(`${missingCompType} plass${missingCompType > 1 ? 'er' : ''} mangler honorarmodell`)
  if (missingAmount > 0) bookingBlockers.push(`${missingAmount} plass${missingAmount > 1 ? 'er' : ''} mangler beløp/prosent`)
  if (blockingIssueCount > 0) bookingBlockers.push(`${blockingIssueCount} plass${blockingIssueCount > 1 ? 'er' : ''} har ugyldige verdier`)
  if (totalPercent > 100) bookingBlockers.push(`Prosentfordeling er ${Math.round(totalPercent * 10) / 10} % (maks 100 %)`)
  const canStartBooking = bookingBlockers.length === 0

  return (
    <div className="max-w-4xl space-y-4">
      {/* ── Existing requirements ─────────────────────────────────────────── */}
      {orderedRequirements.length > 0 && (
        <div className="space-y-2">
          {orderedRequirements.map((req, index) => {
            const state = reqStates[req.id] ?? stateFromRequirement(req)
            const saving = savingIds.has(req.id)
            const issue = compensationIssue(orderedIds, reqStates, req.id, state)
            const activeDropTarget = dropTarget?.id === req.id ? dropTarget.edge : null

            return (
              <div
                key={req.id}
                draggable={canEdit}
                onDragStart={(event) => handleDragStart(req.id, event)}
                onDragOver={(event) => handleDragOver(req.id, event)}
                onDrop={(event) => handleDrop(req.id, event)}
                onDragEnd={() => {
                  setDraggingId(null)
                  setDropTarget(null)
                }}
                className={cn(
                  'relative overflow-hidden rounded-xl border bg-card transition-all',
                  draggingId === req.id && 'scale-[0.995] opacity-70',
                  isReordering && 'duration-150'
                )}
              >
                {activeDropTarget && (
                  <div
                    className={cn(
                      'pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary',
                      activeDropTarget === 'top' ? 'top-0' : 'bottom-0'
                    )}
                  />
                )}

                {/* ── Header row ── */}
                <div className="flex items-center gap-2 border-b bg-muted/20 px-2 py-1.5">
                  <button
                    type="button"
                    aria-label={`Flytt lineup-plass ${index + 1}`}
                    className="inline-flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>
                  </button>
                  <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-secondary border border-border px-1.5 text-[11px] font-semibold tabular-nums text-secondary-foreground">
                    {index + 1}
                  </span>
                  <select
                    value={state.role_name}
                    onChange={(e) => updateField(req.id, 'role_name', e.target.value)}
                    onBlur={() => flushAutosave(req.id)}
                    className="h-7 min-w-0 flex-1 rounded-md border-transparent bg-transparent px-1.5 text-sm font-semibold shadow-none outline-none focus:border focus:border-border focus:bg-background"
                  >
                    {ARTIST_ROLE_LABEL_OPTIONS.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    {issue && <StatusPill tone={issue.tone}>{issue.message}</StatusPill>}
                    {saving && (
                      <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary animate-pulse">
                        Lagrer…
                      </span>
                    )}
                    {isReordering && (
                      <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        …
                      </span>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="h-7 w-7 rounded-md text-muted-foreground"
                          aria-label="Handlinger"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem
                          onSelect={() => {
                            const fd = new FormData()
                            fd.set('show_id', showId)
                            fd.set('role_name', state.role_name)
                            fd.set('quantity', '1')
                            fd.set('min_score', state.min_score)
                            fd.set('energy_level', state.energy_level)
                            fd.set('required_gender', state.required_gender)
                            fd.set('compensation_type', state.compensation_type)
                            fd.set('compensation_amount', state.compensation_amount)
                            fd.set('compensation_percent', state.compensation_percent)
                            startAdding(async () => {
                              try {
                                await addRequirementAction(fd)
                                toast.success('Lineup-plass duplisert')
                                router.refresh()
                              } catch (err: unknown) {
                                toast.error((err as Error)?.message ?? 'Feil ved duplisering')
                              }
                            })
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                          Dupliser
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <ToastActionForm action={deleteRequirementAction}>
                          <input type="hidden" name="show_id" value={showId} />
                          <input type="hidden" name="req_id" value={req.id} />
                          <DropdownMenuItem
                            asChild
                            className="text-destructive focus:text-destructive"
                          >
                            <button type="submit" className="w-full">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                              Slett
                            </button>
                          </DropdownMenuItem>
                        </ToastActionForm>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* ── Field table ── */}
                <div className="grid grid-cols-2 divide-x divide-y sm:grid-cols-3 md:grid-cols-5 md:divide-y-0">
                  <FieldCell label="Score">
                    <Select
                      value={state.min_score || '__none'}
                      onValueChange={(value) => updateField(req.id, 'min_score', value === '__none' ? '' : value)}
                    >
                      <SelectTrigger className="h-7 w-full rounded-md border-transparent bg-transparent px-1.5 text-sm shadow-none focus-visible:border-border focus-visible:bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Velg minimumsscore</SelectLabel>
                        <SelectItem value="__none">Ingen krav</SelectItem>
                        {SCORE_OPTIONS.map((score) => (
                          <SelectItem key={score} value={score}>≥ {score}</SelectItem>
                        ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </FieldCell>

                  <FieldCell label="Energi">
                    <Select
                      value={state.energy_level}
                      onValueChange={(value) => updateField(req.id, 'energy_level', value)}
                    >
                      <SelectTrigger className="h-7 w-full rounded-md border-transparent bg-transparent px-1.5 text-sm shadow-none focus-visible:border-border focus-visible:bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Velg energinivå</SelectLabel>
                        {ENERGY_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </FieldCell>

                  <FieldCell label="Kjønn">
                    <Select
                      value={state.required_gender}
                      onValueChange={(value) => updateField(req.id, 'required_gender', value)}
                    >
                      <SelectTrigger className="h-7 w-full rounded-md border-transparent bg-transparent px-1.5 text-sm shadow-none focus-visible:border-border focus-visible:bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Velg kjønn</SelectLabel>
                        {GENDER_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </FieldCell>

                  <FieldCell label="Honorar">
                    <Select
                      value={state.compensation_type || '__unset'}
                      onValueChange={(value) => updateField(req.id, 'compensation_type', value === '__unset' ? '' : value)}
                    >
                      <SelectTrigger className="h-7 w-full rounded-md border-transparent bg-transparent px-1.5 text-sm shadow-none focus-visible:border-border focus-visible:bg-background">
                        <SelectValue placeholder="Ikke satt" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Velg honorarmodell</SelectLabel>
                          <SelectItem value="__unset">Ikke satt</SelectItem>
                          <SelectItem value="fixed">Fast beløp</SelectItem>
                          <SelectItem value="percent">Prosent</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </FieldCell>

                  <FieldCell label={state.compensation_type === 'percent' ? 'Prosent' : 'Beløp'}>
                    {state.compensation_type === '' ? (
                      <span className="block px-1.5 text-sm text-muted-foreground">—</span>
                    ) : (
                      <div className="relative">
                        <Input
                          type="number"
                          min={0}
                          step={state.compensation_type === 'percent' ? '0.5' : '100'}
                          value={state.compensation_type === 'percent' ? state.compensation_percent : state.compensation_amount}
                          onChange={(event) => updateField(
                            req.id,
                            state.compensation_type === 'percent' ? 'compensation_percent' : 'compensation_amount',
                            event.target.value
                          )}
                          onBlur={() => flushAutosave(req.id)}
                          placeholder={state.compensation_type === 'percent' ? '25' : '3500'}
                          className="h-7 rounded-md border-transparent bg-transparent px-1.5 pr-9 text-sm shadow-none focus-visible:border-border focus-visible:bg-background"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] font-medium text-muted-foreground">
                          {state.compensation_type === 'percent' ? '%' : showCurrency}
                        </span>
                      </div>
                    )}
                  </FieldCell>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Add requirement wizard ─────────────────────────────────────────── */}
      {canEdit && (
        wizard.step === 0 ? (
          <button
            type="button"
            //onClick={() => setWizard({ ...WIZARD_INITIAL, step: 1, lineup_position: orderedRequirements.length + 1 })}
            onClick={() => submitDefault()} 
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-transparent py-5 text-sm font-medium text-muted-foreground transition-all hover:border-foreground/30 hover:bg-muted/20 hover:text-foreground"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50 group-hover:opacity-100 transition-opacity"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            Legg til ny lineup-plass
          </button>
        ) : (
          <AddWizard
            wizard={wizard}
            setWizard={setWizard}
            onSubmit={submitWizard}
            isSubmitting={isAdding}
            showCurrency={showCurrency}
            existingPercentTotal={totalPercent}
          />
        )
      )}

      {/* ── Start booking CTA ─────────────────────────────────────────────── */}
      {requirements.length > 0 && ['draft', 'booking'].includes(showStatus) && (
        <ToastActionForm
          action={startBookingAction}
          successMessage="Booking startet! Tilbud sendes til matchende artister."
          className={cn(
            'rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3',
            canStartBooking
              ? 'ring-1 ring-primary/20 bg-primary/5'
              : 'ring-1 ring-amber-400/40 bg-amber-50/40 dark:bg-amber-950/20'
          )}
        >
          <input type="hidden" name="show_id" value={showId} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm">Klar til å starte booking?</div>
            {canStartBooking ? (
              <div className="text-xs text-muted-foreground mt-0.5">
                Sender tilbud automatisk til artister som matcher kravene.
              </div>
            ) : (
              <ul className="mt-1.5 space-y-0.5">
                {bookingBlockers.map((reason) => (
                  <li key={reason} className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636-2.87L13.637 3.59a1.914 1.914 0 0 0-3.274 0z"/><path d="M12 17.01l.01-.011"/></svg>
                    {reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button type="submit" size="sm" className="shrink-0" disabled={!canStartBooking}>
            Start booking →
          </Button>
        </ToastActionForm>
      )}
    </div>
  )
}

// ─── ChipButton ───────────────────────────────────────────────────────────────

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  )
}

function StatusPill({ tone, children }: { tone: CompensationIssue['tone']; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1',
        tone === 'destructive'
          ? 'bg-destructive/10 text-destructive ring-destructive/20'
          : 'bg-amber-500/10 text-amber-700 ring-amber-500/20'
      )}
    >
      {children}
    </span>
  )
}

function FieldCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-2 py-1.5">
      <Label className="block text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

// ─── AddWizard ────────────────────────────────────────────────────────────────

function AddWizard({
  wizard,
  setWizard,
  onSubmit,
  isSubmitting,
  showCurrency,
  existingPercentTotal,
}: {
  wizard: WizardState
  setWizard: React.Dispatch<React.SetStateAction<WizardState>>
  onSubmit: () => void
  isSubmitting: boolean
  showCurrency: string
  existingPercentTotal: number
}) {
  const roleInputRef = React.useRef<HTMLInputElement>(null)
  const TOTAL_STEPS = 6

  React.useEffect(() => {
    if (wizard.step === 1) {
      setTimeout(() => roleInputRef.current?.focus(), 50)
    }
  }, [wizard.step])

  function next() {
    setWizard((prev) => ({ ...prev, step: (Math.min(prev.step + 1, TOTAL_STEPS) as WizardStep) }))
  }
  function back() {
    setWizard((prev) => ({
      ...prev,
      step: prev.step === 6 && prev.compensation_type === '' ? 4 : (Math.max(prev.step - 1, 1) as WizardStep),
    }))
  }

  function chooseCompensationType(value: RequirementCompensationType | '') {
    setWizard((prev) => ({
      ...prev,
      compensation_type: value,
      compensation_amount: value === 'fixed' ? prev.compensation_amount : '',
      compensation_percent: value === 'percent' ? prev.compensation_percent : '',
      step: value === '' ? 6 : 5,
    }))
  }

  const progress = ((wizard.step - 1) / TOTAL_STEPS) * 100
  const wizardPercent = wizard.compensation_type === 'percent' ? toPlainNumber(wizard.compensation_percent) ?? 0 : 0
  const projectedPercentTotal = existingPercentTotal + wizardPercent
  const percentOverflow = projectedPercentTotal > 100.0001
  const compensationValueMissing = wizard.compensation_type === 'fixed'
    ? toPlainNumber(wizard.compensation_amount) == null
    : wizard.compensation_type === 'percent'
      ? toPlainNumber(wizard.compensation_percent) == null
      : false

  // Breadcrumb trail of already-answered steps
  const trail = [
    wizard.step > 1 && wizard.role_name,
    wizard.step > 2 && (wizard.min_score ? `score ≥ ${wizard.min_score}` : 'alle scorer'),
    wizard.step > 3 && ENERGY_LABELS[wizard.energy_level],
    wizard.step > 4 && (wizard.compensation_type === 'fixed'
      ? 'fast beløp'
      : wizard.compensation_type === 'percent'
        ? 'prosent'
        : 'honorar senere'),
  ].filter(Boolean) as string[]

  return (
    <Card className="gap-0 ring-primary/20 pt-5 pb-0">
      {/* Slim progress bar */}
      <div className="h-1 bg-muted rounded-full mx-6 mb-2 overflow-hidden ">
        <div
          className="h-full bg-green-400 rounded-full transition-all duration-400"
          style={{ width: `${progress}%` }}
        />
      </div>

      <CardHeader className="border-b pb-2.5!">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 mt-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Ny plass — steg {wizard.step}/{TOTAL_STEPS}
            </p>
            {trail.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {trail.map((t, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-xs text-muted-foreground font-medium"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setWizard(WIZARD_INITIAL)}
            className="text-muted-foreground shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="py-5">

        {/* ── Step 1: Role ────────────────────────────────────────────────── */}
        {wizard.step === 1 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold mb-1">Hvilken rolle?</h3>
              <p className="text-sm text-muted-foreground">Velg én av de fire faste rollene i systemet.</p>
            </div>
            <Select
              value={wizard.role_name || '__unset'}
              onValueChange={(value) => setWizard((prev) => ({ ...prev, role_name: value === '__unset' ? '' : value }))}
            >
              <SelectTrigger className="text-base h-11 w-full">
                <SelectValue placeholder="Velg rolle" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__unset">Velg rolle</SelectItem>
                {ARTIST_ROLE_LABEL_OPTIONS.map((role) => (
                  <SelectItem key={role} value={role}>{role}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end pt-1">
              <Button onClick={next} disabled={!wizard.role_name.trim()} size="sm">
                Neste →
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Score ───────────────────────────────────────────────── */}
        {wizard.step === 2 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold mb-1">Minimum score?</h3>
              <p className="text-sm text-muted-foreground">Admin-score for artist (1–10)</p>
            </div>
            <Select
              value={wizard.min_score || '__none'}
              onValueChange={(v) => {
                setWizard((prev) => ({ ...prev, min_score: v === '__none' ? '' : v }))
                next()
              }}
            >
              <SelectTrigger className="w-full h-10">
                <SelectValue placeholder="Velg min. score" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Ingen krav</SelectItem>
                {SCORE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>≥ {s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-between pt-1">
              <Button variant="ghost" size="sm" onClick={back}>
                ← Tilbake
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Energy ──────────────────────────────────────────────── */}
        {wizard.step === 3 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold mb-1">Energinivå?</h3>
              <p className="text-sm text-muted-foreground">Artistens sceneuttrykk</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ENERGY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setWizard((prev) => ({ ...prev, energy_level: opt.value }))
                    next()
                  }}
                  className={`h-16 rounded-xl border text-sm font-semibold transition-all flex flex-col items-center justify-center gap-1 ${
                    wizard.energy_level === opt.value
                      ? 'bg-primary text-primary-foreground border-primary ring-2 ring-primary/20'
                      : 'bg-muted/30 text-muted-foreground border-border hover:border-foreground/30 hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  <span className="text-lg">{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-between pt-1">
              <Button variant="ghost" size="sm" onClick={back}>
                ← Tilbake
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 4: Compensation type ───────────────────────────────────── */}
        {wizard.step === 4 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold mb-1">Hvordan skal komikeren betales?</h3>
              <p className="text-sm text-muted-foreground">Velg fast honorar, prosent av totalen, eller la det stå åpent.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {COMPENSATION_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => chooseCompensationType(option.value)}
                  className={cn(
                    'rounded-2xl border p-4 text-left transition-all',
                    wizard.compensation_type === option.value
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border bg-muted/20 hover:border-foreground/30 hover:bg-muted/40'
                  )}
                >
                  <div className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ring-1', option.accent)}>
                    {option.label}
                  </div>
                  <p className="mt-3 text-sm font-semibold text-foreground">{option.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{option.hint}</p>
                </button>
              ))}
            </div>
            <div className="flex justify-between pt-1">
              <Button variant="ghost" size="sm" onClick={back}>
                ← Tilbake
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 5: Compensation value ─────────────────────────────────── */}
        {wizard.step === 5 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold mb-1">
                {wizard.compensation_type === 'percent' ? 'Hvor stor prosentandel?' : 'Hva er fast honorar?'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {wizard.compensation_type === 'percent'
                  ? 'Summen av prosentene kan være under 100%, men aldri over.'
                  : `Beløpet lagres i ${showCurrency} for denne lineup-plassen.`}
              </p>
            </div>

            <div className="relative">
              <Input
                type="number"
                min={0}
                step={wizard.compensation_type === 'percent' ? '0.5' : '100'}
                value={wizard.compensation_type === 'percent' ? wizard.compensation_percent : wizard.compensation_amount}
                onChange={(event) => setWizard((prev) => ({
                  ...prev,
                  [wizard.compensation_type === 'percent' ? 'compensation_percent' : 'compensation_amount']: event.target.value,
                }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !compensationValueMissing && !percentOverflow) {
                    next()
                  }
                }}
                placeholder={wizard.compensation_type === 'percent' ? 'f.eks. 25' : 'f.eks. 3500'}
                className="h-11 pr-14 text-base"
              />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-medium text-muted-foreground">
                {wizard.compensation_type === 'percent' ? '%' : showCurrency}
              </span>
            </div>

            {wizard.compensation_type === 'percent' && (
              <div className={cn(
                'rounded-xl border px-3 py-2 text-sm',
                percentOverflow ? 'border-destructive/20 bg-destructive/5 text-destructive' : 'border-border bg-muted/20 text-muted-foreground'
              )}>
                {percentOverflow
                  ? `Denne fordelingen ville gitt ${formatPercent(projectedPercentTotal)}%. Det er for høyt.`
                  : `${formatPercent(projectedPercentTotal)}% blir fordelt totalt hvis du lagrer denne plassen.`}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <Button variant="ghost" size="sm" onClick={back}>
                ← Tilbake
              </Button>
              <Button onClick={next} disabled={compensationValueMissing || percentOverflow} size="sm">
                Neste →
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 6: Gender + confirm ───────────────────────────────────── */}
        {wizard.step === 6 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-base font-semibold mb-1">Kjønnskrav?</h3>
              <p className="text-sm text-muted-foreground">Filtrer på artistens kjønn hvis det er relevant for plassen.</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {GENDER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setWizard((prev) => ({ ...prev, required_gender: opt.value }))
                  }
                  className={`h-14 rounded-xl border text-sm font-semibold transition-all flex flex-col items-center justify-center gap-0.5 ${
                    wizard.required_gender === opt.value
                      ? 'bg-primary text-primary-foreground border-primary ring-2 ring-primary/20'
                      : 'bg-muted/30 text-muted-foreground border-border hover:border-foreground/30 hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  <span className="text-base">{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>

            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="text-muted-foreground">Rolle: <strong className="text-foreground">{wizard.role_name}</strong></span>
                <span className="text-muted-foreground">Score: <strong className="text-foreground">{wizard.min_score ? `≥ ${wizard.min_score}` : '—'}</strong></span>
                <span className="text-muted-foreground">Energi: <strong className="text-foreground">{ENERGY_LABELS[wizard.energy_level]}</strong></span>
                <span className="text-muted-foreground">Honorar: <strong className="text-foreground">{compensationSummary(wizard, showCurrency)}</strong></span>
                <span className="text-muted-foreground">Kjønn: <strong className="text-foreground">{GENDER_LABELS[wizard.required_gender]}</strong></span>
              </div>
            </div>

            {percentOverflow && (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                Total prosent ville blitt {formatPercent(projectedPercentTotal)}%. Det må være 100% eller lavere.
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <Button variant="ghost" size="sm" onClick={back}>
                ← Tilbake
              </Button>
              <Button onClick={onSubmit} disabled={isSubmitting || percentOverflow} size="sm">
                {isSubmitting ? 'Legger til…' : 'Legg til ✓'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
