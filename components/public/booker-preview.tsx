import { CalendarDays, Check, Crown, LoaderCircle, Mic, Star, Trash2, Waves } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A still life of the booking view inside /admin-app, used on the club login
 * page to show what the portal actually looks like before you sign in.
 *
 * Deliberately static markup rather than the real component: the real lineup
 * table needs a show, a club and a session, none of which exist on a login
 * screen. It carries `role="img"` so a screen reader gets one description
 * instead of reading a fictional lineup as if it were live data.
 */

const SPOTS = [
  { role: 'Headliner', icon: Crown, name: 'Jim Green', fee: '30% of sales', booked: true },
  { role: 'Host / MC', icon: Star, name: 'Alicia Bento', fee: '20% of sales', booked: true },
  { role: 'Regular spot', icon: Mic, name: 'Jamal Henk', fee: '10% of sales', booked: true },
  { role: 'Open Mic', icon: Waves, name: 'Henki Freem', fee: 'No fee', booked: true },
  { role: 'Regular spot', icon: Mic, name: 'Booking', fee: 'Fixed fee', booked: false },
  { role: 'Regular spot', icon: Mic, name: 'Booking', fee: 'Fixed fee', booked: false },
  { role: 'Regular spot', icon: Mic, name: 'Booking', fee: 'Fixed fee', booked: false },
]

const FILLED = SPOTS.filter((spot) => spot.booked).length

export function BookerPreview({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label={`Preview of the Tickethalo booking view: the show “Laugh-out Club night” with ${FILLED} of ${SPOTS.length} spots booked.`}
      className={cn(
        'overflow-hidden rounded-2xl bg-white text-zinc-900 shadow-[0_18px_48px_rgba(46,12,1,0.12)] ring-1 ring-black/5',
        className,
      )}
    >
      {/* Show header */}
      <div className="flex items-start gap-4 px-5 pt-5">
        <div className="flex shrink-0 flex-col items-center gap-1">
          <div className="grid size-14 place-content-center rounded-xl bg-[#ff5b24] text-center leading-none text-white">
            <span className="text-[20px] font-bold">7</span>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em]">Jul</span>
          </div>
          <span className="text-[11px] font-medium text-zinc-400">2027</span>
        </div>
        <div className="pt-1">
          <h3 className="text-[19px] font-semibold tracking-[-0.02em]">Laugh-out Club night</h3>
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-zinc-500">
            <CalendarDays className="size-3.5" aria-hidden />7 July 2027
          </p>
        </div>
      </div>

      {/* Lineup */}
      <div className="mx-4 mb-4 mt-4 overflow-hidden rounded-xl border border-zinc-200">
        <div className="overflow-x-auto">
          <div className="min-w-[312px] sm:min-w-[420px]">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <div className="shrink-0 whitespace-nowrap">
                <p className="text-[11px] leading-tight text-zinc-500">Booking status</p>
                <p className="text-[13px] font-medium">{FILLED}/{SPOTS.length} spots filled</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {SPOTS.map((spot, i) => (
                  <span
                    key={i}
                    className={cn('h-[5px] w-4 rounded-full sm:w-7', spot.booked ? 'bg-[#ff5b24]' : 'bg-zinc-200')}
                  />
                ))}
              </div>
            </div>

            {SPOTS.map((spot, i) => {
              const Icon = spot.icon
              return (
                <div
                  key={i}
                  className={cn(
                    'flex items-center border-b border-zinc-100 text-[12px] last:border-b-0',
                    !spot.booked && 'bg-blue-50/40',
                  )}
                >
                  <span
                    className={cn(
                      'my-2.5 ml-3 grid size-6 shrink-0 place-content-center rounded-md text-[11px] font-semibold',
                      spot.booked ? 'bg-[#ff5b24] text-white' : 'bg-zinc-100 text-zinc-500',
                    )}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={cn(
                      'ml-3 flex w-[96px] shrink-0 items-center gap-1.5 self-stretch px-2 font-medium sm:w-[112px]',
                      spot.booked ? 'bg-orange-50/70 text-[#b23004]' : 'bg-blue-50/70 text-blue-700',
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{spot.role}</span>
                  </span>
                  <span className={cn('w-[88px] shrink-0 px-2 font-medium sm:w-[96px] sm:px-3', !spot.booked && 'text-zinc-500')}>
                    {spot.name}
                  </span>
                  <span className="hidden flex-1 whitespace-nowrap px-2 text-zinc-500 sm:block">{spot.fee}</span>
                  <span
                    className={cn(
                      'ml-auto mr-3 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium',
                      spot.booked ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-600',
                    )}
                  >
                    {spot.booked ? (
                      <Check className="size-3" aria-hidden />
                    ) : (
                      <LoaderCircle className="size-3" aria-hidden />
                    )}
                    {spot.booked ? 'Booked' : 'Available'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Card actions */}
      <div className="flex items-center justify-between gap-4 px-5 pb-5">
        <span className="rounded-lg border border-zinc-200 px-3 py-1.5 text-[12px] font-medium">View details</span>
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-red-600">
          <Trash2 className="size-3.5" aria-hidden />
          Delete show
        </span>
      </div>
    </div>
  )
}
