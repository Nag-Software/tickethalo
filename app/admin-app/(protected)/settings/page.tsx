import { AdminHeader } from '@/components/admin/admin-header'

/*
 * Bare om nøkkelen er satt, aldri noe av verdien. Siden er åpen for alle
 * klubbadministratorer, og selv fire tegn av service role-nøkkelen hører
 * ikke hjemme der.
 */
const integrations = [
  {
    group: 'Payments',
    items: [
      { name: 'Stripe', key: 'STRIPE_SECRET_KEY', configured: Boolean(process.env.STRIPE_SECRET_KEY), desc: 'Payment processor' },
      { name: 'Stripe Webhook Secret', key: 'STRIPE_WEBHOOK_SECRET', configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET), desc: 'Webhook signing' },
    ],
  },
  {
    group: 'Database',
    items: [
      { name: 'Supabase URL', key: 'NEXT_PUBLIC_SUPABASE_URL', configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL), desc: 'Database URL' },
      { name: 'Supabase Publishable Key', key: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY), desc: 'Anon/publishable key' },
      { name: 'Supabase Service Role Key', key: 'SUPABASE_SERVICE_ROLE_KEY', configured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), desc: 'Admin key' },
    ],
  },
  {
    group: 'AI',
    items: [
      { name: 'OpenAI API Key', key: 'OPENAI_API_KEY', configured: Boolean(process.env.OPENAI_API_KEY), desc: 'Poster generation' },
    ],
  },
  {
    group: 'Email',
    items: [
      { name: 'Resend API Key', key: 'RESEND_API_KEY', configured: Boolean(process.env.RESEND_API_KEY), desc: 'Email provider' },
    ],
  },
]

export default function SettingsPage() {
  return (
    <div>
      <AdminHeader title="Settings" description="System configuration and integrations" />
      <div className="p-6 space-y-8">
        {integrations.map((group) => (
          <section key={group.group}>
            <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">{group.group}</h2>
            <div className="rounded-lg border divide-y">
              {group.items.map((item) => {
                const ok = item.configured
                return (
                  <div key={item.key} className="flex items-center justify-between px-4 py-3.5 gap-4">
                    <div>
                      <div className="font-medium text-sm">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{item.desc}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        {ok ? 'Configured' : 'Not configured'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
