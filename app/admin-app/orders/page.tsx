import { Suspense } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { getClubAccess } from '@/lib/club-auth'
import { stripe } from '@/lib/stripe'
import Stripe from 'stripe'
import { CircleHelp, CreditCard } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

type PaymentMethodInfo = {
  key: 'vipps' | 'klarna' | 'card' | 'unknown'
  label: string
}

const unknownPaymentMethod: PaymentMethodInfo = {
  key: 'unknown',
  label: 'Ukjent',
}

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  refunded: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-zinc-100 text-zinc-500',
}

const statusLabels: Record<string, string> = {
  pending: 'Venter',
  paid: 'Betalt',
  failed: 'Feilet',
  refunded: 'Refundert',
  cancelled: 'Avbrutt',
}

function resolvePaymentMethod(session: Stripe.Checkout.Session): PaymentMethodInfo {
  const methodTypes = session.payment_method_types ?? []

  if (methodTypes.includes('vipps')) {
    return { key: 'vipps', label: 'Vipps' }
  }

  if (methodTypes.includes('klarna')) {
    return { key: 'klarna', label: 'Klarna' }
  }

  const paymentIntent = typeof session.payment_intent === 'object' ? session.payment_intent : null
  const paymentMethod = paymentIntent && typeof paymentIntent.payment_method === 'object'
    ? paymentIntent.payment_method
    : null

  if (paymentMethod?.type === 'klarna') {
    return { key: 'klarna', label: 'Klarna' }
  }

  if (paymentMethod?.type === 'card' || methodTypes.includes('card')) {
    return { key: 'card', label: 'Bankkort' }
  }

  return { key: 'unknown', label: 'Ukjent' }
}

async function getPaymentMethodMap(sessionIds: string[]) {
  if (!process.env.STRIPE_SECRET_KEY || sessionIds.length === 0) {
    return {} as Record<string, PaymentMethodInfo>
  }

  const results = await Promise.allSettled(
    sessionIds.map(async (sessionId) => {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['payment_intent.payment_method'],
      })

      return [sessionId, resolvePaymentMethod(session)] as const
    }),
  )

  return results.reduce<Record<string, PaymentMethodInfo>>((accumulator, result) => {
    if (result.status === 'fulfilled') {
      const [sessionId, paymentMethod] = result.value
      accumulator[sessionId] = paymentMethod
    }

    return accumulator
  }, {})
}

function PaymentMethodBadge({ method }: { method: PaymentMethodInfo }) {
  if (method.key === 'vipps') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-[10px] font-black text-white">V</span>
        {method.label}
      </span>
    )
  }

  if (method.key === 'klarna') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-pink-50 px-2.5 py-1 text-xs font-medium text-pink-700">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-pink-500 text-[10px] font-black text-white">K</span>
        {method.label}
      </span>
    )
  }

  if (method.key === 'card') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
        <CreditCard className="h-3.5 w-3.5" />
        {method.label}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">
      <CircleHelp className="h-3.5 w-3.5" />
      {method.label}
    </span>
  )
}

async function loadOrders() {
  const db = createAdminClient()
  const clubAccess = await getClubAccess()

  // Scope to club's shows (fetch title in same query so we skip a follow-up)
  const { data: clubShows } = clubAccess.clubIds.length
    ? await db
        .from('shows')
        .select('id, title')
        .in('club_id', clubAccess.clubIds)
    : { data: [] as Array<{ id: string; title: string }> }
  const showIds = (clubShows ?? []).map((s) => s.id)

  const { data: orders } = showIds.length
    ? await db
        .from('orders')
        .select('id, show_id, stripe_checkout_session_id, amount_total, currency, status, buyer_email, buyer_name, created_at')
        .in('show_id', showIds)
        .order('created_at', { ascending: false })
        .limit(100)
    : { data: [] }

  const orderIds = (orders ?? []).map((order) => order.id)
  const stripeSessionIds = [...new Set((orders ?? []).flatMap((order) => order.stripe_checkout_session_id ? [order.stripe_checkout_session_id] : []))]
  const { data: ticketRows } = orderIds.length
    ? await db.from('tickets').select('order_id, status').in('order_id', orderIds)
    : { data: [] as Array<{ order_id: string; status: string }> }
  const showMap = Object.fromEntries((clubShows ?? []).map(s => [s.id, s]))

  const ticketSummaryMap = (ticketRows ?? []).reduce<Record<string, { total: number; checkedIn: number }>>((accumulator, ticket) => {
    const current = accumulator[ticket.order_id] ?? { total: 0, checkedIn: 0 }
    current.total += 1
    if (ticket.status === 'used') current.checkedIn += 1
    accumulator[ticket.order_id] = current
    return accumulator
  }, {})

  return { orders: orders ?? [], showMap, ticketSummaryMap, stripeSessionIds }
}

type OrdersData = Awaited<ReturnType<typeof loadOrders>>

function OrdersTableSkeleton() {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <Skeleton className="h-8 w-full rounded-md" />
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full rounded-md" />
      ))}
    </div>
  )
}

async function OrdersTable({ data }: { data: OrdersData }) {
  const { orders, showMap, ticketSummaryMap, stripeSessionIds } = data
  const paymentMethodMap = await getPaymentMethodMap(stripeSessionIds)

  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/30 border-b text-xs text-muted-foreground">
            <th className="text-left px-4 py-2.5 font-medium">Kjøper</th>
            <th className="text-left px-4 py-2.5 font-medium">Show</th>
            <th className="text-left px-4 py-2.5 font-medium">Beløp</th>
            <th className="text-left px-4 py-2.5 font-medium">Status</th>
            <th className="text-left px-4 py-2.5 font-medium">Betalingsmåte</th>
            <th className="text-left px-4 py-2.5 font-medium">Tidspunkt</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const show = o.show_id ? showMap[o.show_id] : null
            const ticketSummary = ticketSummaryMap[o.id] ?? { total: 0, checkedIn: 0 }
            const isCheckedIn = ticketSummary.total > 0 && ticketSummary.checkedIn === ticketSummary.total
            const paymentMethod = o.stripe_checkout_session_id
              ? paymentMethodMap[o.stripe_checkout_session_id] ?? unknownPaymentMethod
              : unknownPaymentMethod

            return (
              <tr key={o.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium">{o.buyer_name ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">{o.buyer_email}</div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{show?.title ?? '—'}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">
                    {o.amount_total
                      ? new Intl.NumberFormat('nb-NO', {
                          style: 'currency',
                          currency: (o.currency ?? 'NOK').toUpperCase(),
                          maximumFractionDigits: 0,
                        }).format(o.amount_total / 100)
                      : '—'}
                  </div>
                  <div className="text-xs text-muted-foreground">{ticketSummary.total || 0} stk</div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[o.status] ?? 'bg-zinc-100 text-zinc-600'}`}>
                      {statusLabels[o.status] ?? o.status}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isCheckedIn ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>
                      {isCheckedIn ? 'Innsjekket' : 'Ikke sjekket inn'}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <PaymentMethodBadge method={paymentMethod} />
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(o.created_at).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!orders.length && (
        <p className="text-center py-12 text-muted-foreground text-sm">Ingen ordere ennå.</p>
      )}
    </div>
  )
}

export default async function OrdersPage() {
  const data = await loadOrders()

  return (
    <div>
      <AdminHeader title="Ordere" description={`${data.orders.length} ordre`} />
      <div className="p-6">
        <Suspense fallback={<OrdersTableSkeleton />}>
          <OrdersTable data={data} />
        </Suspense>
      </div>
    </div>
  )
}
