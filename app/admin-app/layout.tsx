/**
 * The club portal's outer shell. Deliberately free of auth checks: the gate
 * lives in `(protected)/layout.tsx` so that it never has to redirect to
 * `/admin-app/login` from inside the same layout that renders it — doing so
 * left the router refetching the login route forever instead of committing it.
 */
export const metadata = { title: 'Booking centre — Tickethalo' }

export default function AdminAppLayout({ children }: { children: React.ReactNode }) {
  return children
}
