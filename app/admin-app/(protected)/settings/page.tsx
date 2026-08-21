import { AdminHeader } from '@/components/admin/admin-header'

const integrations = [
  {
    group: 'Betalinger',
    items: [
      { name: 'Stripe', key: 'STRIPE_SECRET_KEY', envVar: process.env.STRIPE_SECRET_KEY, desc: 'Betalingsbehandler' },
      { name: 'Stripe Webhook Secret', key: 'STRIPE_WEBHOOK_SECRET', envVar: process.env.STRIPE_WEBHOOK_SECRET, desc: 'Webhook signering' },
    ],
  },
  {
    group: 'Database',
    items: [
      { name: 'Supabase URL', key: 'NEXT_PUBLIC_SUPABASE_URL', envVar: process.env.NEXT_PUBLIC_SUPABASE_URL, desc: 'Database URL' },
      { name: 'Supabase Publishable Key', key: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', envVar: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, desc: 'Anon/publishable nøkkel' },
      { name: 'Supabase Service Role Key', key: 'SUPABASE_SERVICE_ROLE_KEY', envVar: process.env.SUPABASE_SERVICE_ROLE_KEY, desc: 'Admin-nøkkel (skjult)' },
    ],
  },
  {
    group: 'AI',
    items: [
      { name: 'OpenAI API Key', key: 'OPENAI_API_KEY', envVar: process.env.OPENAI_API_KEY, desc: 'Plakatgenerering' },
    ],
  },
  {
    group: 'E-post',
    items: [
      { name: 'Resend API Key', key: 'RESEND_API_KEY', envVar: process.env.RESEND_API_KEY, desc: 'E-postleverandør' },
    ],
  },
]

function maskValue(val: string | undefined): string {
  if (!val) return ''
  if (val.length <= 8) return '••••••••'
  return val.slice(0, 4) + '•••••••••••' + val.slice(-4)
}

export default function SettingsPage() {
  return (
    <div>
      <AdminHeader title="Settings" description="Systemkonfigurasjon og integrasjoner" />
      <div className="p-6 space-y-8">
        {integrations.map((group) => (
          <section key={group.group}>
            <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">{group.group}</h2>
            <div className="rounded-lg border divide-y">
              {group.items.map((item) => {
                const ok = !!item.envVar
                return (
                  <div key={item.key} className="flex items-center justify-between px-4 py-3.5 gap-4">
                    <div>
                      <div className="font-medium text-sm">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{item.desc}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono text-xs text-muted-foreground">
                        {ok ? maskValue(item.envVar) : '—'}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        {ok ? 'OK' : 'Mangler'}
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
