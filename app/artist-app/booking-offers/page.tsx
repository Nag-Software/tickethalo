import { redirect } from 'next/navigation'

export default async function BookingOffersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  redirect(`/artist-app/bookings${status ? `?status=${encodeURIComponent(status)}` : ''}`)
}
