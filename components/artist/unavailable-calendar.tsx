'use client'

import { useCallback, useMemo, useRef, useState, useTransition } from 'react'
import { DayPicker, type DayButton } from 'react-day-picker'
import { enGB } from 'date-fns/locale'
import { toast } from 'sonner'
import { saveUnavailableDatesAction } from '@/app/artist-app/actions'
import { portalButton } from '@/components/artist/portal-ui'

/**
 * Kalenderen der komikeren markerer dagene hen ikke kan.
 *
 * Tre ting den må klare, som en vanlig datovelger ikke gjør:
 *
 *  1. **Male.** En komiker som er på turné i ti dager skal ikke trykke ti
 *     ganger. Hold inne og dra, så får alle dagene samme tilstand som den
 *     første fikk. Fungerer med mus og med finger.
 *  2. **Lagre fortløpende.** Ingen «Lagre»-knapp å glemme. Hvert trykk og
 *     hvert dra sender bare det som er endret.
 *  3. **Vite hva som står på spill.** En dag med bekreftet booking kan ikke
 *     markeres, og en dag med et ubesvart tilbud må bekreftes — å markere
 *     den er i praksis et nei.
 *
 * Tilstanden holdes lokalt og rulles tilbake om lagringen feiler, slik at
 * kalenderen aldri viser noe annet enn det som står i databasen.
 */

export type UnavailableCalendarProps = {
  /** `YYYY-MM-DD`. Dagene komikeren allerede har markert. */
  initialUnavailable: string[]
  /** Dager komikeren har en bekreftet plass. Låst. */
  booked: string[]
  /** Dager med et ubesvart tilbud. Krever bekreftelse. */
  pendingOffer: string[]
}

function toKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function keysBetween(from: string, to: string): string[] {
  const start = from <= to ? from : to
  const end = from <= to ? to : from
  const keys: string[] = []

  for (let date = fromKey(start); toKey(date) <= end; date.setDate(date.getDate() + 1)) {
    keys.push(toKey(date))
  }
  return keys
}

/**
 * Dagknappen.
 *
 * Ligger utenfor komponenten med vilje. Var den definert inne i render,
 * ville den vært en ny komponenttype for hver tilstandsendring, og React
 * ville byttet ut hele rutenettet for hvert trykk — nye DOM-noder, tapt
 * fokus, og en `aria-pressed` som ble hengende på den gamle noden.
 */
function CalendarDayButton({ day, modifiers, className, ...props }: React.ComponentProps<typeof DayButton>) {
  return (
    <button
      {...props}
      type="button"
      data-cal-date={toKey(day.date)}
      className={className}
      aria-pressed={Boolean(modifiers.unavailable)}
    />
  )
}

const CALENDAR_COMPONENTS = { DayButton: CalendarDayButton }

function formatDay(key: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })
    .format(fromKey(key))
}

export function UnavailableCalendar({ initialUnavailable, booked, pendingOffer }: UnavailableCalendarProps) {
  const [marked, setMarked] = useState<Set<string>>(() => new Set(initialUnavailable))
  const [confirming, setConfirming] = useState<{ dates: string[] } | null>(null)
  const [, startTransition] = useTransition()

  const bookedSet = useMemo(() => new Set(booked), [booked])

  /** Det som faktisk er lagret. Kalenderen rulles tilbake hit når noe feiler. */
  const savedRef = useRef<Set<string>>(new Set(initialUnavailable))
  /**
   * Det som vises, speilet i en ref.
   *
   * Et dra oppdaterer tilstanden mange ganger før det slippes, og da må
   * `endDrag` vite hva som faktisk står der. Å lese det ut av en
   * `setState`-oppdaterer ville gjort lagringen til en bieffekt som React
   * kan kjøre to ganger.
   */
  const markedRef = useRef<Set<string>>(new Set(initialUnavailable))
  const drag = useRef<{ mode: boolean; last: string | null; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const anchor = useRef<string | null>(null)

  /** Én lagring av gangen, og en ny runde hvis det kom endringer imens. */
  const saving = useRef(false)
  const dirty = useRef(false)
  /** Datoene komikeren har sagt ja til å avslå tilbud på. */
  const confirmedFor = useRef<Set<string>>(new Set())

  /**
   * Dagens dato, lest på nytt hver gang.
   *
   * Sto den i en `useMemo` med tom avhengighetsliste, trodde en fane som
   * hadde stått åpen over midnatt fortsatt at i går var i dag. Serveren
   * forkastet da dagen som passert, og kalenderen ble stående og vise en
   * markering som ikke fantes noe sted.
   */
  const canPaint = useCallback(
    (key: string) => key >= toKey(new Date()) && !bookedSet.has(key),
    [bookedSet],
  )

  const setBoth = useCallback((next: Set<string>) => {
    markedRef.current = next
    setMarked(next)
  }, [])

  /**
   * Lagrer forskjellen mellom det som vises og det som er lagret.
   *
   * Én om gangen, og alltid mot `savedRef` slik den er *nå*. Tidligere tok
   * hver lagring en kopi av den lagrede tilstanden og regnet mot den: to
   * raske trykk ga da to runder som begge regnet mot den samme gamle
   * tilstanden, og den ene kunne både utelate en endring og — hvis den
   * feilet — rulle kalenderen tilbake forbi noe den andre nettopp hadde
   * lagret. Neste trykk sendte det som en sletting.
   */
  const save = useCallback(function save() {
    if (saving.current) { dirty.current = true; return }

    const saved = savedRef.current
    const target = markedRef.current
    const add = [...target].filter((key) => !saved.has(key))
    const remove = [...saved].filter((key) => !target.has(key))
    if (add.length === 0 && remove.length === 0) return

    saving.current = true
    startTransition(async () => {
      try {
        const result = await saveUnavailableDatesAction({
          add,
          remove,
          declineOffersOn: [...confirmedFor.current],
        })

        if ('needsConfirm' in result) {
          // Rull tilbake til det lagrede mens komikeren bestemmer seg. Ellers
          // ville kalenderen vist en markering som ikke er lagret noe sted.
          setBoth(new Set(savedRef.current))
          setConfirming({ dates: result.needsConfirm })
          return
        }

        if ('error' in result) {
          setBoth(new Set(savedRef.current))
          toast.error(result.error)
          return
        }

        const next = new Set(savedRef.current)
        for (const key of result.added) next.add(key)
        for (const key of result.removed) next.delete(key)
        savedRef.current = next

        // Serveren kan ha forkastet en dato — typisk en dag som rakk å bli
        // i går. Da skal den bort fra kalenderen også, ellers blir den
        // stående og se lagret ut for alltid.
        const refused = add.filter((key) => !result.added.includes(key))
        if (refused.length > 0) {
          const cleaned = new Set(markedRef.current)
          for (const key of refused) cleaned.delete(key)
          setBoth(cleaned)
          toast.info(refused.length === 1
            ? 'That day has already been, so it was not saved.'
            : `${refused.length} days had already been, so they were not saved.`)
        }

        if (result.warning) toast.warning(result.warning)
        confirmedFor.current = new Set()
      } catch {
        setBoth(new Set(savedRef.current))
        toast.error('The dates could not be saved right now. Try again.')
      } finally {
        saving.current = false
        if (dirty.current) { dirty.current = false; save() }
      }
    })
  }, [setBoth])

  const applyKeys = useCallback((keys: string[], mode: boolean) => {
    const next = new Set(markedRef.current)
    let changed = false

    for (const key of keys) {
      if (!canPaint(key)) continue
      if (mode && !next.has(key)) { next.add(key); changed = true }
      if (!mode && next.has(key)) { next.delete(key); changed = true }
    }

    if (changed) setBoth(next)
  }, [canPaint, setBoth])

  const dateAtPoint = (clientX: number, clientY: number): string | null => {
    const element = document.elementFromPoint(clientX, clientY)
    const cell = element?.closest('[data-cal-date]')
    return cell?.getAttribute('data-cal-date') ?? null
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Hver ny berøring starter blankt. Et dra ender som regel på en annen
    // dag enn det startet på, og da får ingen dagknapp noe klikk — flagget
    // ble stående, og det neste trykket forsvant i stillhet.
    suppressClick.current = false

    // Bare primærknappen maler. Uten dette satte et høyreklikk i gang et
    // dra som menyen spiste opp `pointerup` fra, og musa malte videre uten
    // at noen knapp var nede.
    if (event.button !== 0) return

    const key = dateAtPoint(event.clientX, event.clientY)
    if (!key) return

    if (bookedSet.has(key)) {
      suppressClick.current = true
      toast.info('You are booked that evening. Get in touch with the club.')
      return
    }
    if (!canPaint(key)) return

    // Shift markerer et spenn fra forrige dag komikeren trykket på.
    if (event.shiftKey && anchor.current) {
      event.preventDefault()
      suppressClick.current = true
      const mode = !markedRef.current.has(key)
      applyKeys(keysBetween(anchor.current, key), mode)
      anchor.current = key
      save()
      return
    }

    drag.current = { mode: !markedRef.current.has(key), last: key, moved: false }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state) return

    // Slipper knappen utenfor rutenettet, kommer det ingen `pointerup` hit.
    if (event.buttons === 0) { endDrag(); return }

    const key = dateAtPoint(event.clientX, event.clientY)
    if (!key || key === state.last) return

    // Første bevegelse: nå er det et dra, ikke et trykk. Da males også
    // dagen draget startet på, og klikket etterpå skal ikke gjøre noe.
    if (!state.moved) {
      state.moved = true
      suppressClick.current = true
      applyKeys([state.last!], state.mode)
    }

    // Hele strekket mellom de to avlesningene, ikke bare rutene pekeren
    // tilfeldigvis ble målt på. Et raskt dra over en uke traff ellers bare
    // start og slutt, og etterlot hull komikeren ikke så.
    applyKeys(state.last ? keysBetween(state.last, key) : [key], state.mode)
    state.last = key
  }

  const endDrag = () => {
    const state = drag.current
    drag.current = null
    if (!state) return

    if (state.moved) {
      save()
    } else {
      anchor.current = state.last
    }
  }

  const handleDayClick = (day: Date) => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }

    const key = toKey(day)
    if (bookedSet.has(key)) {
      toast.info('You are booked that evening. Get in touch with the club.')
      return
    }
    if (!canPaint(key)) return

    anchor.current = key
    const next = new Set(markedRef.current)
    if (next.has(key)) next.delete(key)
    else next.add(key)

    setBoth(next)
    save()
  }

  /**
   * Komikeren sier ja til at tilbudene på de dagene kan avslås.
   *
   * Datoene sendes med, ikke bare et «ja». Kommer et nytt tilbud inn mens
   * dialogen står åpen, spør serveren på nytt i stedet for å avslå noe
   * komikeren aldri fikk se.
   */
  const confirmDecline = () => {
    const pending = confirming
    if (!pending) return

    setConfirming(null)
    confirmedFor.current = new Set([...confirmedFor.current, ...pending.dates])

    const next = new Set(savedRef.current)
    for (const key of pending.dates) next.add(key)

    setBoth(next)
    save()
  }

  const markedDates = useMemo(() => [...marked].map(fromKey), [marked])
  const bookedDates = useMemo(() => booked.map(fromKey), [booked])
  const offerDates = useMemo(() => pendingOffer.map(fromKey), [pendingOffer])

  return (
    <div className="flex flex-col gap-5">
      <div
        className="select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <DayPicker
          locale={enGB}
          weekStartsOn={1}
          numberOfMonths={2}
          startMonth={new Date()}
          showOutsideDays={false}
          disabled={{ before: new Date() }}
          modifiers={{ unavailable: markedDates, booked: bookedDates, offer: offerDates }}
          modifiersClassNames={{
            unavailable: 'rdp-unavailable',
            booked: 'rdp-booked',
            offer: 'rdp-offer',
            today: 'rdp-today',
          }}
          onDayClick={handleDayClick}
          components={CALENDAR_COMPONENTS}
          className="ev-calendar"
          classNames={{
            months: 'flex flex-col gap-6 sm:flex-row sm:gap-8',
            month: 'flex flex-col gap-3',
            month_caption: 'flex h-9 items-center justify-center text-[14px] font-semibold',
            nav: 'flex items-center gap-1',
            button_previous: 'inline-flex size-8 items-center justify-center rounded-full text-[var(--ev-muted)] hover:bg-[var(--ev-card-hover)]',
            button_next: 'inline-flex size-8 items-center justify-center rounded-full text-[var(--ev-muted)] hover:bg-[var(--ev-card-hover)]',
            month_grid: 'w-full border-collapse',
            weekdays: 'flex',
            weekday: 'w-10 text-[11px] font-medium uppercase tracking-wide text-[var(--ev-faint)]',
            week: 'mt-1 flex w-full',
            day: 'p-0.5',
          }}
        />
      </div>

      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-[var(--ev-muted)]">
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-[var(--ev-text)]" /> Cannot do
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-[var(--ev-accent-fill)]" /> Booked
        </li>
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-full border-2 border-dashed border-[var(--ev-muted)]" /> Offer waiting
        </li>
      </ul>

      {confirming && (
        <div
          className="bg-[var(--ev-card)] p-5"
          style={{ borderRadius: 'var(--ev-r-card)' }}
          role="alertdialog"
          aria-labelledby="confirm-decline-heading"
        >
          <h2 id="confirm-decline-heading" className="text-[15px] font-semibold">
            You have an offer on {confirming.dates.length === 1 ? 'that date' : 'those dates'}
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--ev-muted)]">
            Marking {confirming.dates.map(formatDay).join(', ')} as unavailable turns the offer down at the same
            time. The spot goes to another comedian.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={portalButton.primary} onClick={confirmDecline}>
              Mark it and turn the offer down
            </button>
            <button type="button" className={portalButton.secondary} onClick={() => setConfirming(null)}>
              Keep the offer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
