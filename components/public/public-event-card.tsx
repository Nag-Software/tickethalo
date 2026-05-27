import Image from 'next/image'
import Link from 'next/link'
import { ArrowUpRight, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PublicShow } from '@/lib/public-events'
import { formatShortDate, formatShowTime, formatTicketPrice, remainingTickets, ticketFillPercent } from '@/lib/public-events'
import { startCheckoutAction } from '@/app/events/actions'

export function PublicEventCard({ show, priority = false, compact = false }: { show: PublicShow; priority?: boolean; compact?: boolean }) {
  const remaining = remainingTickets(show)
  const soldOut = remaining === 0
  const fillPercent = ticketFillPercent(show)
  const [day, month] = formatShortDate(show.date).split(' ')
  const showLocation = show.venue_name ?? show.venue_address

  return (
    <article className="group border border-black bg-white transition hover:-translate-y-0.5 hover:shadow-[2px_2px_0_black/10]">
      <Link href={`/events/${show.slug}`} className="block">
        <div className="relative aspect-[3/3.7] border-b border-black bg-zinc-950 overflow-hidden">
          {show.poster_url ? (
            <Image src={show.poster_url} alt={show.title} fill priority={priority} sizes={compact ? '(max-width: 768px) 92vw, 31vw' : '(max-width: 768px) 92vw, (max-width: 1024px) 45vw, 31vw'} className="object-contain transition aspect-[3/3.7] duration-500 group-hover:scale-[1.02]" />
          ) : (
            <div className={`flex h-full flex-col justify-between bg-black text-white ${compact ? 'p-4' : 'p-5'}`}>
              <span className="text-xs font-bold uppercase tracking-widest">humor.events</span>
              <strong className={`font-medium leading-none ${compact ? 'text-2xl' : 'text-3xl'}`}>{show.title}</strong>
            </div>
          )}
          <div className={`absolute left-3 top-3 border border-black bg-white px-3 py-2 text-center text-black ${compact ? 'py-1.5' : ''}`}>
            <div className={`font-medium leading-none tracking-normal ${compact ? 'text-xl' : 'text-2xl'}`}>{day}</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{month}</div>
          </div>
        </div>
      </Link>
      <div className={`grid ${compact ? 'gap-3 p-3' : 'gap-4 p-4'}`}>
        <div>
          <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            <span>{formatShowTime(show)}</span>
            <ArrowUpRight className="size-4 transition group-hover:text-[#ff6bff]" />
          </div>
          {show.clubName && (
            <div className="mb-2 inline-flex border border-black px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-700">
              {show.clubName}
            </div>
          )}
          <h3 className={`font-medium leading-tight tracking-normal ${compact ? 'min-h-0 text-base' : 'min-h-0 text-lg sm:min-h-12 sm:text-xl'}`}>{show.title}</h3>
          <p className={`mt-2 text-zinc-500 ${compact ? 'text-xs' : 'text-sm'}`}>
            {[show.clubCity, showLocation ?? 'Sted kommer', formatTicketPrice(show)].filter(Boolean).join(' · ')}
          </p>
        </div>
        {soldOut ? (
          <div className="py-1 text-center text-base font-bold uppercase tracking-widest text-[#ff6bff]">UTSOLGT</div>
        ) : fillPercent >= 80 ? (
          <div className="text-xs font-bold text-[#ff6bff]">Få plasser igjen</div>
        ) : fillPercent >= 50 ? (
          <div className="text-xs font-bold text-zinc-500">Over halvparten solgt</div>
        ) : null}
        <div className="grid gap-2 min-[360px]:grid-cols-2">
          <Button asChild variant="outline" size={compact ? 'sm' : 'default'} className="rounded-none border border-black bg-transparent font-medium hover:bg-black hover:text-white"><Link href={`/events/${show.slug}`}>Les mer <ArrowUpRight className="size-4" /></Link></Button>
          <form action={startCheckoutAction} className="w-full">
            <input type="hidden" name="show_id" value={show.id} />
            <input type="hidden" name="slug" value={show.slug} />
            <Button type="submit" size={compact ? 'sm' : 'default'} className="w-full rounded-none border border-black bg-black font-medium text-white hover:bg-[#ff6bff] hover:text-black hover:border-[#ff6bff]" disabled={soldOut}>
              <Ticket className="size-4" /> {soldOut ? 'Utsolgt' : 'Kjøp'}
            </Button>
          </form>
        </div>
      </div>
    </article>
  )
}