'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Check, ChevronDown, Plus, Search, Send, Trash2, UserPlus, UserRound, XCircle } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RoleIcon, SpotStatusBadge } from '@/components/admin/show-booking-card'
import { ARTIST_ROLE_OPTIONS, artistMatchesRole, canonicalRoleLabel, canonicalRoleValue } from '@/lib/artist-roles'
import type { BookingSpot } from '@/lib/booking-spots'
import { cn } from '@/lib/utils'
import {
  addArtistToRequirementAction,
  addRequirementAction,
  cancelOfferAction,
  deleteSpotAction,
  removeSpotAndReopenAction,
  sendOfferToArtistAction,
  swapArtistAction,
  updateSpotFeeAction,
  updateSpotRoleAction,
} from '@/app/admin-app/(protected)/shows/actions'

export type LineupArtist = {
  id: string
  full_name: string
  stage_name: string | null
  admin_score: number | null
  admin_energy_level: string | null
  category: string[] | null
}

/** What picking an artist in the row's artist list should do. */
type ArtistPickerMode = 'offer' | 'manual' | 'swap'

/** The three fee models a booker actually picks between. */
type FeeMode = 'none' | 'fixed' | 'percent'

function artistLabel(artist: LineupArtist) {
  return artist.stage_name ?? artist.full_name
}

function feeModeOf(fee: BookingSpot['fee']): FeeMode {
  if (fee.type === 'percent') return 'percent'
  if (fee.type === 'fixed' && fee.amount === 0) return 'none'
  return 'fixed'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}

/**
 * The lineup rows of the booking card, made editable in place.
 *
 * Every row is one seat: the role opens a picker, the name opens what can be
 * done with that seat, and the fee opens a small editor. The status is read
 * from the booking itself and is never set by hand.
 */
export function InteractiveLineup({
  showId,
  currency,
  spots,
  artists,
  readOnly = false,
}: {
  showId: string
  currency: string
  spots: BookingSpot[]
  artists: LineupArtist[]
  /** true once the show is over or cancelled — the lineup is then a record. */
  readOnly?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function run(work: () => Promise<void>, success: string) {
    startTransition(async () => {
      try {
        await work()
        toast.success(success)
        router.refresh()
      } catch (error) {
        toast.error(errorMessage(error))
      }
    })
  }

  function fd(entries: Record<string, string>) {
    const formData = new FormData()
    formData.set('show_id', showId)
    for (const [key, value] of Object.entries(entries)) formData.set(key, value)
    return formData
  }

  if (spots.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-4">
        <p className="text-xs text-muted-foreground">Set up lineup spots to start booking.</p>
        {!readOnly && (
          <AddSpotButton
            disabled={isPending}
            onAdd={(role) => run(() => addRequirementAction(fd({ role_name: role })), `${role} spot added.`)}
          />
        )}
      </div>
    )
  }

  return (
    <div className="border-t">
      <ul>
        {spots.map((spot) => (
          <SpotRow
            key={spot.key}
            spot={spot}
            currency={currency}
            artists={artists}
            busy={isPending}
            readOnly={readOnly}
            onRole={(role) =>
              run(
                () => updateSpotRoleAction(fd({ req_id: spot.requirementId, role_name: role })),
                `Spot ${spot.position} is now ${role}.`,
              )
            }
            onFee={(fee) =>
              run(
                () => updateSpotFeeAction(fd({ req_id: spot.requirementId, ...fee })),
                `Fee updated for spot ${spot.position}.`,
              )
            }
            onDeleteSpot={() =>
              run(
                () =>
                  deleteSpotAction(
                    fd({
                      req_id: spot.requirementId,
                      spot_id: spot.spotId ?? '',
                      offer_id: spot.offerId ?? '',
                    }),
                  ),
                `Spot ${spot.position} deleted.`,
              )
            }
            onPickArtist={(mode, artist) => {
              if (mode === 'offer') {
                run(
                  () => sendOfferToArtistAction(fd({ artist_id: artist.id, show_requirement_id: spot.requirementId })),
                  `Request sent to ${artistLabel(artist)}.`,
                )
                return
              }

              if (mode === 'manual') {
                run(
                  () =>
                    addArtistToRequirementAction(
                      fd({ artist_id: artist.id, show_requirement_id: spot.requirementId, currency }),
                    ),
                  `${artistLabel(artist)} was added to the lineup.`,
                )
                return
              }

              if (!spot.spotId) return
              run(
                () => swapArtistAction(fd({ spot_id: spot.spotId as string, new_artist_id: artist.id })),
                `${artistLabel(artist)} took over spot ${spot.position}.`,
              )
            }}
            onRemoveArtist={() => {
              if (spot.spotId) {
                run(
                  () => removeSpotAndReopenAction(fd({ spot_id: spot.spotId as string })),
                  'Artist removed. A new offer round starts automatically.',
                )
                return
              }

              if (spot.offerId) {
                run(() => cancelOfferAction(fd({ offer_id: spot.offerId as string })), 'Request cancelled.')
              }
            }}
          />
        ))}
      </ul>

      {!readOnly && (
        <div className="border-t px-3 py-2">
          <AddSpotButton
            disabled={isPending}
            onAdd={(role) => run(() => addRequirementAction(fd({ role_name: role })), `${role} spot added.`)}
          />
        </div>
      )}
    </div>
  )
}

function AddSpotButton({ disabled, onAdd }: { disabled: boolean; onAdd: (role: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
      >
        <Plus className="size-3.5" />
        Add spot
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>New spot</DropdownMenuLabel>
        {ARTIST_ROLE_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onAdd(option.label)}>
            <RoleIcon roleName={option.value} className="size-4" />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SpotRow({
  spot,
  currency,
  artists,
  busy,
  readOnly,
  onRole,
  onFee,
  onDeleteSpot,
  onPickArtist,
  onRemoveArtist,
}: {
  spot: BookingSpot
  currency: string
  artists: LineupArtist[]
  busy: boolean
  readOnly: boolean
  onRole: (role: string) => void
  onFee: (fee: Record<string, string>) => void
  onDeleteSpot: () => void
  onPickArtist: (mode: ArtistPickerMode, artist: LineupArtist) => void
  onRemoveArtist: () => void
}) {
  const roleLabel = canonicalRoleLabel(spot.roleName) ?? spot.roleName
  const currentRole = canonicalRoleValue(spot.roleName)
  const isOpen = spot.state === 'open'

  return (
    <li className="flex items-stretch border-t text-xs first:border-t-0">
      <div className="flex w-9 shrink-0 items-center justify-center py-3 @[30rem]:w-11">
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-md text-[11px] font-bold tabular-nums',
            spot.state === 'booked' && 'bg-[var(--ev-accent-fill)] text-white',
            spot.state === 'pending' && 'bg-amber-500 text-white',
            isOpen && 'bg-muted text-muted-foreground',
          )}
        >
          {spot.position}
        </span>
      </div>

      {/* Role — a plain select of the lineup types, icon and all. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={readOnly || busy}
          aria-label={`Spot ${spot.position}: ${roleLabel} — change lineup type`}
          className={cn(
            'group/role flex w-9 shrink-0 items-center justify-center gap-1.5 py-3 text-left transition-colors @[22rem]:w-24 @[22rem]:justify-start @[22rem]:px-2.5 @[30rem]:w-28',
            spot.state === 'booked' && 'bg-[var(--ev-accent-fill)]/10 text-[var(--ev-accent)] dark:text-[var(--ev-accent-fill)]',
            spot.state === 'pending' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
            isOpen && 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
            !readOnly && 'hover:brightness-95 data-[state=open]:brightness-95 disabled:hover:brightness-100',
          )}
        >
          <RoleIcon roleName={spot.roleName} className="size-3.5 shrink-0" />
          <span className="hidden truncate font-medium @[22rem]:inline">{roleLabel}</span>
          {!readOnly && (
            <ChevronDown className="ml-auto hidden size-3 shrink-0 opacity-0 transition-opacity group-hover/role:opacity-60 group-data-[state=open]/role:opacity-60 @[22rem]:block" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuLabel>Lineup type</DropdownMenuLabel>
          {ARTIST_ROLE_OPTIONS.map((option) => (
            <DropdownMenuItem key={option.value} onSelect={() => onRole(option.label)}>
              <RoleIcon roleName={option.value} className="size-4" />
              {option.label}
              {currentRole === option.value && <Check className="ml-auto size-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1.5">
        <ArtistCell
          spot={spot}
          artists={artists}
          disabled={readOnly || busy}
          onPickArtist={onPickArtist}
          onRemoveArtist={onRemoveArtist}
          onDeleteSpot={onDeleteSpot}
        />
        <FeeCell spot={spot} currency={currency} disabled={readOnly || busy} onFee={onFee} />
      </div>

      <div className="flex shrink-0 items-center justify-end py-3 pr-3 @[30rem]:w-[8.25rem]">
        <SpotStatusBadge state={spot.state} />
      </div>
    </li>
  )
}

function ArtistCell({
  spot,
  artists,
  disabled,
  onPickArtist,
  onRemoveArtist,
  onDeleteSpot,
}: {
  spot: BookingSpot
  artists: LineupArtist[]
  disabled: boolean
  onPickArtist: (mode: ArtistPickerMode, artist: LineupArtist) => void
  onRemoveArtist: () => void
  onDeleteSpot: () => void
}) {
  const [open, setOpen] = useState(false)
  const [picker, setPicker] = useState<ArtistPickerMode | null>(null)
  // Å slette en plass noen står på avlyser bookingen deres. Det bekreftes i
  // menyen framfor med en nettleserdialog, som ellers er det eneste stedet i
  // kortet noe spretter ut av siden.
  const [confirming, setConfirming] = useState(false)

  function close() {
    setOpen(false)
    setPicker(null)
    setConfirming(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setPicker(null)
          setConfirming(false)
        }
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        aria-label={`Spot ${spot.position}: ${spot.artistName ?? 'not booked'} — change booking`}
        className={cn(
          'group/name flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-muted data-[state=open]:bg-muted disabled:hover:bg-transparent',
          spot.artistName ? 'font-semibold' : 'text-muted-foreground',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{spot.artistName ?? 'Not booked'}</span>
        {!disabled && (
          <ChevronDown className="size-3 shrink-0 opacity-0 transition-opacity group-hover/name:opacity-60 group-data-[state=open]/name:opacity-60" />
        )}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 gap-0 p-1.5">
        {confirming ? (
          <ConfirmDelete
            spot={spot}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              onDeleteSpot()
              close()
            }}
          />
        ) : picker ? (
          <ArtistPicker
            title={picker === 'swap' ? 'Change artist' : picker === 'offer' ? 'Send request to' : 'Add manually'}
            roleName={spot.roleName}
            artists={artists}
            onBack={() => setPicker(null)}
            onPick={(artist) => {
              onPickArtist(picker, artist)
              close()
            }}
          />
        ) : (
          <MenuList>
            {spot.state === 'open' && (
              <>
                <MenuButton icon={Send} onClick={() => setPicker('offer')}>
                  Send request
                  <MenuHint>Ask an artist, they accept themselves</MenuHint>
                </MenuButton>
                <MenuButton icon={UserPlus} onClick={() => setPicker('manual')}>
                  Add manually
                  <MenuHint>Book the artist straight into the spot</MenuHint>
                </MenuButton>
              </>
            )}

            {spot.state === 'booked' && (
              <>
                <MenuButton icon={UserRound} onClick={() => setPicker('swap')}>
                  Change
                  <MenuHint>Swap in another artist</MenuHint>
                </MenuButton>
                <MenuButton
                  icon={Trash2}
                  destructive
                  onClick={() => {
                    onRemoveArtist()
                    close()
                  }}
                >
                  Remove
                  <MenuHint>Frees the spot and starts a new offer round</MenuHint>
                </MenuButton>
              </>
            )}

            {spot.state === 'pending' && (
              <>
                <MenuButton icon={UserPlus} onClick={() => setPicker('manual')}>
                  Change
                  <MenuHint>Book someone else straight into the spot</MenuHint>
                </MenuButton>
                <MenuButton
                  icon={Trash2}
                  destructive
                  onClick={() => {
                    onRemoveArtist()
                    close()
                  }}
                >
                  Remove
                  <MenuHint>Withdraws the request that is out</MenuHint>
                </MenuButton>
              </>
            )}

            <MenuButton
              icon={XCircle}
              destructive
              onClick={() => {
                // En tom plass er ingenting å bekrefte bort.
                if (spot.state === 'open') {
                  onDeleteSpot()
                  close()
                  return
                }
                setConfirming(true)
              }}
            >
              Delete spot
              <MenuHint>
                {spot.state === 'open'
                  ? 'Takes the row out of the lineup'
                  : spot.state === 'booked'
                    ? 'Cancels the booking and takes the row out'
                    : 'Withdraws the request and takes the row out'}
              </MenuHint>
            </MenuButton>
          </MenuList>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ConfirmDelete({
  spot,
  onCancel,
  onConfirm,
}: {
  spot: BookingSpot
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="flex flex-col gap-2 p-1.5">
      <p className="text-sm font-semibold">Delete spot {spot.position}?</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {spot.state === 'booked'
          ? `${spot.artistName ?? 'The artist'} loses the booking, and the row is taken out of the lineup. No new request is sent.`
          : `The request out to ${spot.artistName ?? 'the artist'} is withdrawn, and the row is taken out of the lineup.`}
      </p>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          Keep it
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 rounded-xl bg-destructive px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-destructive/90"
        >
          Delete spot
        </button>
      </div>
    </div>
  )
}

function MenuList({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col">{children}</div>
}

function MenuHint({ children }: { children: React.ReactNode }) {
  return <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">{children}</span>
}

function MenuButton({
  icon: Icon,
  destructive = false,
  onClick,
  children,
}: {
  icon: typeof Send
  destructive?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
        destructive ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </button>
  )
}

function ArtistPicker({
  title,
  roleName,
  artists,
  onBack,
  onPick,
}: {
  title: string
  roleName: string
  artists: LineupArtist[]
  onBack: () => void
  onPick: (artist: LineupArtist) => void
}) {
  const [query, setQuery] = useState('')

  // Comedians who actually do this kind of spot come first — the rest stay
  // reachable, because a booker sometimes knows better than the category.
  const ordered = useMemo(() => {
    const text = query.trim().toLowerCase()
    return artists
      .filter((artist) => !text || artistLabel(artist).toLowerCase().includes(text))
      .sort((a, b) => {
        const matchDelta = Number(artistMatchesRole(roleName, b)) - Number(artistMatchesRole(roleName, a))
        if (matchDelta !== 0) return matchDelta
        return artistLabel(a).localeCompare(artistLabel(b))
      })
  }, [artists, query, roleName])

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 px-1 pb-1.5">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <span className="text-xs font-semibold">{title}</span>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search artists"
          className="w-full rounded-xl border bg-background py-2 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="mt-1.5 max-h-64 overflow-y-auto">
        {ordered.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">No artists available.</p>
        ) : (
          ordered.map((artist) => (
            <button
              key={artist.id}
              type="button"
              onClick={() => onPick(artist)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{artistLabel(artist)}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {artist.admin_score == null ? 'no score' : `score ${artist.admin_score}`}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function FeeCell({
  spot,
  currency,
  disabled,
  onFee,
}: {
  spot: BookingSpot
  currency: string
  disabled: boolean
  onFee: (fee: Record<string, string>) => void
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<FeeMode>(() => feeModeOf(spot.fee))
  const [amount, setAmount] = useState(() => (spot.fee.amount == null ? '' : String(spot.fee.amount / 100)))
  const [percent, setPercent] = useState(() => (spot.fee.percent == null ? '' : String(spot.fee.percent)))

  function reset() {
    setMode(feeModeOf(spot.fee))
    setAmount(spot.fee.amount == null ? '' : String(spot.fee.amount / 100))
    setPercent(spot.fee.percent == null ? '' : String(spot.fee.percent))
  }

  function save() {
    if (mode === 'none') {
      onFee({ compensation_type: 'fixed', compensation_amount: '0' })
    } else if (mode === 'fixed') {
      onFee({ compensation_type: 'fixed', compensation_amount: amount })
    } else {
      onFee({ compensation_type: 'percent', compensation_percent: percent })
    }
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) reset()
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        aria-label={`Spot ${spot.position}: ${spot.feeLabel} — change fee`}
        className="group/fee hidden w-[6.5rem] shrink-0 items-center gap-1 rounded-lg px-1.5 py-1.5 text-left text-muted-foreground transition-colors hover:bg-muted data-[state=open]:bg-muted disabled:hover:bg-transparent @[30rem]:flex"
      >
        <span className="min-w-0 flex-1 truncate">{spot.feeLabel}</span>
        {!disabled && (
          <ChevronDown className="size-3 shrink-0 opacity-0 transition-opacity group-hover/fee:opacity-60 group-data-[state=open]/fee:opacity-60" />
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64 gap-3">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {(
            [
              { value: 'none', label: 'No fee' },
              { value: 'fixed', label: 'Fixed' },
              { value: 'percent', label: '% of sales' },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setMode(option.value)}
              className={cn(
                'rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors',
                mode === option.value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {mode === 'fixed' && (
          <label className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{currency}</span>
            <input
              autoFocus
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        )}

        {mode === 'percent' && (
          <label className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">%</span>
            <input
              autoFocus
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
              placeholder="0"
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        )}

        {mode === 'none' && <p className="text-xs text-muted-foreground">The artist plays this spot without a fee.</p>}

        <button
          type="button"
          onClick={save}
          className="rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Save fee
        </button>
      </PopoverContent>
    </Popover>
  )
}
