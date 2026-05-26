'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ArrowUpRight, CalendarIcon, Ticket } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ToastActionForm } from '@/components/toast-action-form'
import { Button } from '@/components/ui/button'
import { startCheckoutAction } from '@/app/events/actions'
import type { PublicShow } from '@/lib/public-events'
import { formatShortDate, formatShowTime, formatTicketPrice, remainingTickets, ticketFillPercent } from '@/lib/public-events'
import { nb } from 'date-fns/locale'

function formatDateLabel(d: Date) {
  return d.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface Props {
  shows: PublicShow[]
  userCountry?: string
}

export function EventsGridClient({ shows, userCountry = 'kvelder' }: Props) {
  const [date, setDate] = useState<Date | undefined>(undefined)
  const [city, setCity] = useState('Alle')

  const cityOptions = [
    'Alle',
    ...new Set(
      shows
        .map((show) => show.clubCity?.trim())
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => a.localeCompare(b, 'nb-NO'))
    ),
  ]

  const filtered = shows.filter((show) => {
    if (city !== 'Alle' && show.clubCity !== city) return false
    if (!date) return true
    const showDate = new Date(show.date)
    return (
      showDate.getFullYear() === date.getFullYear() &&
      showDate.getMonth() === date.getMonth() &&
      showDate.getDate() === date.getDate()
    )
  })

  return (
    <section id="events-section" className="px-4 md:px-8 pb-16 pt-6 md:pt-20">
      <div className="max-w-8xl mx-auto">
        <div className="flex flex-wrap items-center gap-0 mb-6 md:mb-8 animate-fade-in" style={{ animationDelay: '0.8s', animationFillMode: 'both' }}>
          <h2 className="text-base md:text-lg lg:text-xl font-normal w-full sm:w-auto mb-2 sm:mb-0">
            Norges morsomste
          </h2>
          <span className="text-base md:text-lg lg:text-xl font-normal border border-black px-2 py-1 sm:ml-2">
            {userCountry}
          </span>

          {/* Mobile/tablet date picker */}
          <div className="lg:hidden">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    'text-base md:text-lg lg:text-xl font-normal border border-l-0 border-black px-2 py-1 flex items-center bg-white hover:bg-gray-50 transition-colors',
                    !date && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? formatDateLabel(date) : <span>Velg en dato</span>}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" onSelect={setDate} locale={nb} />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {cityOptions.length > 1 && (
          <div className="mb-6 flex flex-wrap gap-2 animate-fade-in" style={{ animationDelay: '0.85s', animationFillMode: 'both' }}>
            {cityOptions.map((option) => {
              const active = option === city
              const count = option === 'Alle'
                ? shows.length
                : shows.filter((show) => show.clubCity === option).length

              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCity(option)}
                  className={cn(
                    'inline-flex items-center gap-2 border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] transition-colors',
                    active
                      ? 'border-black bg-black text-white'
                      : 'border-black bg-white text-black hover:bg-[#ff6bff]'
                  )}
                >
                  <span>{option}</span>
                  <span className={cn('text-[10px]', active ? 'text-white/75' : 'text-zinc-500')}>{count}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8 lg:gap-12 mt-8 md:mt-16">
          {/* Desktop calendar */}
          <div
            className="hidden lg:block animate-fade-in lg:sticky lg:top-24 self-start"
            style={{ animationDelay: '0.9s', animationFillMode: 'both' }}
          >
            <Calendar mode="single" selected={date} onSelect={setDate} className="mx-auto" locale={nb} />
          </div>

          {/* Event grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 2xl:grid-cols-3 lg:col-start-2 gap-5">
            {filtered.length === 0 ? (
              <div className="col-span-full text-center py-12">
                {date
                  ? `Ingen eventer funnet for ${date.toLocaleDateString('nb-NO', { weekday: 'long', month: 'long', day: 'numeric' })}`
                  : 'Ingen eventer funnet.'}
              </div>
            ) : (
              filtered.map((show, index) => (
                <div
                  key={show.id}
                  className="animate-fade-in"
                  style={{ animationDelay: `${1.0 + index * 0.1}s`, animationFillMode: 'both' }}
                >
                  <EventCard show={show} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function EventCard({ show }: { show: PublicShow }) {
  const remaining = remainingTickets(show)
  const soldOut = remaining === 0
  const fillPercent = ticketFillPercent(show)
  const lowStock = remaining !== null && remaining > 0 && (remaining <= 10 || fillPercent >= 80)
  const [day, month = ''] = formatShortDate(show.date).split(' ')
  const eventHref = `/events/${show.slug ?? show.id}`
  const showLocation = show.venue_name ?? show.venue_address ?? 'Sted kommer'
  const statusLabel = soldOut ? 'Utsolgt' : lowStock ? 'Få igjen' : null

  return (
    <article className="group flex h-full flex-col overflow-hidden border border-black bg-white transition hover:-translate-y-0.5 hover:shadow-[4px_4px_0_rgba(0,0,0,0.12)]">
      <Link href={eventHref} className="block">
        <div className="relative overflow-hidden border-b border-black bg-zinc-950">
          <div className="absolute left-3 top-3 z-10 grid size-12 place-items-center border border-black bg-white text-center text-black sm:left-4 sm:top-4 sm:size-14">
            <div>
              <div className="text-2xl font-medium leading-none">{Number(day)}</div>
              <div className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500 sm:text-[10px]">{month.replace('.', '')}</div>
            </div>
          </div>

          <div className="relative aspect-[2/3] w-full overflow-hidden transition duration-500 group-hover:scale-[1.02]">
            {show.poster_url ? (
              <Image
                src={show.poster_url}
                alt={show.title}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 34vw, 16vw"
              />
            ) : (
              <div className="flex h-full flex-col justify-between bg-black p-4 text-white">
                <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">humor.events</span>
                <strong className="text-2xl font-medium leading-none">{show.title}</strong>
              </div>
            )}
          </div>
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-7 bg-white p-4 sm:p-5">
        <div className="grid gap-3">
          <div className="flex min-h-8 items-start justify-between gap-3">
            <span className="text-sm font-medium uppercase tracking-[0.22em] text-zinc-500">{formatShowTime(show)}</span>
            {statusLabel && (
              <span className={cn(
                'shrink-0 rounded-full border border-black px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em]',
                soldOut ? 'bg-black text-white' : 'bg-[#ff6bff] text-black'
              )}>
                {statusLabel}
              </span>
            )}
          </div>
          <div>
            {show.clubName && (
              <div className="mb-2 inline-flex border border-black px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-700">
                {show.clubName}
              </div>
            )}
            <h3 className="text-xl font-medium leading-tight tracking-normal">{show.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">{[show.clubCity, showLocation, formatTicketPrice(show)].filter(Boolean).join(' · ')}</p>
          </div>
        </div>

        <div className="mt-auto grid grid-cols-2 gap-2">
          <Button asChild variant="outline" className="h-11 rounded-none border border-black bg-transparent text-sm font-medium text-black hover:bg-black hover:text-white">
            <Link href={eventHref}>Les mer <ArrowUpRight className="size-5" /></Link>
          </Button>
          <ToastActionForm action={startCheckoutAction} className="w-full">
            <input type="hidden" name="show_id" value={show.id} />
            <input type="hidden" name="slug" value={show.slug ?? show.id} />
            <Button type="submit" className="h-11 w-full rounded-none border border-black bg-black text-sm font-medium text-white hover:border-[#ff6bff] hover:bg-[#ff6bff] hover:text-black disabled:opacity-45" disabled={soldOut}>
              <Ticket className="size-5" /> {soldOut ? 'Utsolgt' : 'Kjøp'}
            </Button>
          </ToastActionForm>
        </div>
      </div>
    </article>
  )
}
