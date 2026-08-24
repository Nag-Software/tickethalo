import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { getClubAccess } from '@/lib/club-auth'
import { CircleHelp, CreditCard } from 'lucide-react'
import { refundOrderAction } from '@/lib/actions/refund'
import { RefundOrderButton } from '@/components/admin/refund-order-button'

type PaymentMethodInfo = {
  key: 'vipps' | 'klarna' | 'card' | 'unknown'
  label: string
}

const unknownPaymentMethod: PaymentMethodInfo = {
  key: 'unknown',
  label: 'Unknown',
}

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  refunded: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-zinc-100 text-zinc-500',
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
}

/**
 * The payment method is stored on the order at purchase time (migration 032).
 * Before that the list fetched one Stripe session per row — a hundred orders
 * meant a hundred calls, and after the move to Connect each of them would have
 * had to know which club account the session lived on.
 */
function resolvePaymentMethod(type: string | null): PaymentMethodInfo {
  if (!type) return unknownPaymentMethod
  if (type === 'vipps') return { key: 'vipps', label: 'Vipps' }
  if (type === 'klarna') return { key: 'klarna', label: 'Klarna' }
  if (type === 'card') return { key: 'card', label: 'Card' }
  return unknownPaymentMethod
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

export default async function OrdersPage() {
  const db = createAdminClient()
  const clubAccess = await getClubAccess()

  // Scope to club's shows
  let showIds: string[] = []
  if (clubAccess.clubIds.length > 0) {
    const { data: clubShows } = await db
      .from('shows')
      .select('id')
      .in('club_id', clubAccess.clubIds)
    showIds = (clubShows ?? []).map((s) => s.id)
  }

  const { data: orders } = showIds.length
    ? await db
        .from('orders')
        .select('id, show_id, amount_total, currency, status, buyer_email, buyer_name, created_at, payment_method_type, platform_fee_amount, club_net_amount')
        .in('show_id', showIds)
        .order('created_at', { ascending: false })
        .limit(100)
    : { data: [] }

  const orderShowIds = [...new Set((orders ?? []).filter(o => o.show_id).map(o => o.show_id as string))]
  const orderIds = (orders ?? []).map((order) => order.id)
  const { data: showRows } = orderShowIds.length
    ? await db.from('shows').select('id, title').in('id', orderShowIds)
    : { data: [] as Array<{ id: string; title: string }> }
  const { data: ticketRows } = orderIds.length
    ? await db.from('tickets').select('order_id, status').in('order_id', orderIds)
    : { data: [] as Array<{ order_id: string; status: string }> }
  const showMap = Object.fromEntries((showRows ?? []).map(s => [s.id, s]))

  const ticketSummaryMap = (ticketRows ?? []).reduce<Record<string, { total: number; checkedIn: number }>>((accumulator, ticket) => {
    const current = accumulator[ticket.order_id] ?? { total: 0, checkedIn: 0 }
    current.total += 1
    if (ticket.status === 'used') current.checkedIn += 1
    accumulator[ticket.order_id] = current
    return accumulator
  }, {})

  return (
    <div>
      <AdminHeader title="Orders" description={`${orders?.length ?? 0} orders`} />
      <div className="p-6">
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b text-xs text-muted-foreground">
                <th className="text-left px-4 py-2.5 font-medium">Buyer</th>
                <th className="text-left px-4 py-2.5 font-medium">Show</th>
                <th className="text-left px-4 py-2.5 font-medium">Amount</th>
                <th className="text-left px-4 py-2.5 font-medium">Club&apos;s share</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-left px-4 py-2.5 font-medium">Payment method</th>
                <th className="text-left px-4 py-2.5 font-medium">Time</th>
                <th className="text-right px-4 py-2.5 font-medium">Refund</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((o) => {
                const show = o.show_id ? showMap[o.show_id] : null
                const ticketSummary = ticketSummaryMap[o.id] ?? { total: 0, checkedIn: 0 }
                const isCheckedIn = ticketSummary.total > 0 && ticketSummary.checkedIn === ticketSummary.total
                const paymentMethod = resolvePaymentMethod(o.payment_method_type)
                const money = (value: number | null | undefined) =>
                  value === null || value === undefined
                    ? '—'
                    : new Intl.NumberFormat('en-GB', {
                        style: 'currency',
                        currency: (o.currency ?? 'NOK').toUpperCase(),
                        maximumFractionDigits: 0,
                      }).format(value / 100)

                return (
                  <tr key={o.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{o.buyer_name ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{o.buyer_email}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{show?.title ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{money(o.amount_total)}</div>
                      <div className="text-xs text-muted-foreground">{ticketSummary.total || 0} pcs</div>
                    </td>
                    {/* The club is the seller. The amount above is what the customer
                        paid; this is what the club keeps after commission. */}
                    <td className="px-4 py-3">
                      <div className="font-medium">{money(o.club_net_amount)}</div>
                      <div className="text-xs text-muted-foreground">
                        {o.platform_fee_amount ? `${money(o.platform_fee_amount)} commission` : '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[o.status] ?? 'bg-zinc-100 text-zinc-600'}`}>
                          {statusLabels[o.status] ?? o.status}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isCheckedIn ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}>
                          {isCheckedIn ? 'Checked in' : 'Not checked in'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <PaymentMethodBadge method={paymentMethod} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        {o.status === 'paid' ? (
                          <RefundOrderButton
                            action={refundOrderAction}
                            orderId={o.id}
                            amountLabel={money(o.amount_total)}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!orders?.length && (
            <p className="text-center py-12 text-muted-foreground text-sm">No orders yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}
