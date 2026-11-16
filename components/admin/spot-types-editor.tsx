'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { FIELD_GROUP_CLASS, FIELD_INPUT_CLASS, FieldFrame, FieldSection } from '@/components/admin/form-fields'
import { RoleIcon } from '@/components/admin/show-booking-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MAX_SPOT_TYPE_NAME, type ClubSpotType } from '@/lib/spot-types'
import { cn } from '@/lib/utils'
import {
  addSpotTypeAction,
  moveSpotTypeAction,
  updateSpotTypeAction,
} from '@/app/admin-app/(protected)/my-club/spot-type-actions'

/**
 * «Spot types» under My Club (migrasjon 100).
 *
 * Klubben velger fra standardlista og kan legge til egne typer (Tom,
 * 2026-11-16). Rekkefølgen her er rekkefølgen et nytt show starter med, og
 * «Unpaid» gjør at tilbudet sier rett ut at plassen er ubetalt.
 */
export function SpotTypesEditor({ types }: { types: ClubSpotType[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [newName, setNewName] = useState('')
  const [newUnpaid, setNewUnpaid] = useState(false)
  const [newPercent, setNewPercent] = useState('')

  const ordered = [...types].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name))

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success?: string, after?: () => void) {
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (success) toast.success(success)
      after?.()
      router.refresh()
    })
  }

  function add() {
    run(
      () => addSpotTypeAction({ name: newName, is_unpaid: newUnpaid, default_compensation_percent: newPercent }),
      `${newName.trim()} added.`,
      () => {
        setNewName('')
        setNewUnpaid(false)
        setNewPercent('')
      },
    )
  }

  return (
    <FieldFrame>
      <FieldSection id="spot-types" title="Spot types">
        <div className="col-span-12 space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            The spots your line-ups are built from. A new show starts with one of each active type, in this order.
            Unpaid spots tell the comedian in the offer that the set is unpaid. Shows already booking keep their spots
            as they are.
          </p>

          <ul className="divide-y rounded-2xl border">
            {ordered.map((type, index) => (
              <SpotTypeRow
                key={type.id}
                type={type}
                first={index === 0}
                last={index === ordered.length - 1}
                disabled={pending}
                onToggleActive={(active) =>
                  run(() => updateSpotTypeAction({ id: type.id, active }), active ? `${type.name} switched on.` : `${type.name} switched off.`)}
                onToggleUnpaid={(isUnpaid) => run(() => updateSpotTypeAction({ id: type.id, is_unpaid: isUnpaid }))}
                onPercent={(value) => run(() => updateSpotTypeAction({ id: type.id, default_compensation_percent: value }))}
                onMove={(direction) => run(() => moveSpotTypeAction({ id: type.id, direction }))}
              />
            ))}
          </ul>

          <form
            className="flex flex-wrap items-end gap-2 rounded-2xl border border-dashed p-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (newName.trim()) add()
            }}
          >
            <label className="min-w-0 flex-1 space-y-1">
              <span className="text-xs font-medium">Add your own type</span>
              <div className={FIELD_GROUP_CLASS}>
                <Input
                  value={newName}
                  maxLength={MAX_SPOT_TYPE_NAME}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Guest spot"
                  className={FIELD_INPUT_CLASS}
                />
              </div>
            </label>
            <label className="w-24 space-y-1">
              <span className="text-xs font-medium">Default fee</span>
              <PercentInput value={newPercent} onChange={setNewPercent} label="Default fee for the new type" />
            </label>
            <label className="flex h-10 items-center gap-2 text-sm">
              <input type="checkbox" checked={newUnpaid} onChange={(event) => setNewUnpaid(event.target.checked)} className="size-4" />
              Unpaid
            </label>
            <Button type="submit" size="sm" className="h-10 rounded-xl" disabled={pending || !newName.trim()}>
              <Plus data-icon="inline-start" />
              Add
            </Button>
          </form>
        </div>
      </FieldSection>
    </FieldFrame>
  )
}

function SpotTypeRow({
  type,
  first,
  last,
  disabled,
  onToggleActive,
  onToggleUnpaid,
  onPercent,
  onMove,
}: {
  type: ClubSpotType
  first: boolean
  last: boolean
  disabled: boolean
  onToggleActive: (active: boolean) => void
  onToggleUnpaid: (isUnpaid: boolean) => void
  onPercent: (value: string) => void
  onMove: (direction: 'up' | 'down') => void
}) {
  const saved = type.default_compensation_percent == null ? '' : String(type.default_compensation_percent)
  const [percent, setPercent] = useState(saved)

  return (
    <li className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5', !type.active && 'opacity-60')}>
      <div className="flex shrink-0 flex-col">
        <button
          type="button"
          aria-label={`Move ${type.name} up`}
          disabled={disabled || first}
          onClick={() => onMove('up')}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        >
          <ArrowUp className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Move ${type.name} down`}
          disabled={disabled || last}
          onClick={() => onMove('down')}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        >
          <ArrowDown className="size-3.5" />
        </button>
      </div>

      <RoleIcon roleName={type.name} className="size-4 shrink-0 text-[var(--ev-accent-fill)]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{type.name}</p>
        <p className="text-[11px] text-muted-foreground">{type.standard_key ? 'Standard' : 'Your own'}</p>
      </div>

      <div className="w-24">
        <PercentInput
          value={percent}
          onChange={setPercent}
          onBlur={() => {
            if (percent.trim() !== saved) onPercent(percent)
          }}
          label={`Default fee for ${type.name}`}
          disabled={disabled}
        />
      </div>

      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={type.is_unpaid}
          disabled={disabled}
          onChange={(event) => onToggleUnpaid(event.target.checked)}
          className="size-3.5"
        />
        Unpaid
      </label>

      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={type.active}
          disabled={disabled}
          onChange={(event) => onToggleActive(event.target.checked)}
          className="size-3.5"
        />
        In use
      </label>
    </li>
  )
}

function PercentInput({
  value,
  onChange,
  onBlur,
  label,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <div className={FIELD_GROUP_CLASS}>
      <Input
        inputMode="decimal"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder="0"
        className={cn(FIELD_INPUT_CLASS, 'text-right')}
      />
      <span className="flex items-center pr-3 text-xs text-muted-foreground">%</span>
    </div>
  )
}
