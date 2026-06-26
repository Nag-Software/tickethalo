import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminHeader } from '@/components/admin/admin-header'
import { PosterTemplateEditor } from '@/components/admin/poster-template-editor'
import { getClubAccess } from '@/lib/club-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { templateRowToSchema } from '@/lib/poster-template'
import { renderPosterFromTemplate } from '@/lib/poster-render'
import {
  confirmPosterTemplateAction,
  renderTemplatePreviewAction,
  savePosterTemplateAction,
} from '../../poster-template-actions'

export default async function PosterTemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const access = await getClubAccess()
  if (access.clubIds.length === 0) notFound()

  const db = createAdminClient()
  const { data: row } = await db
    .from('poster_templates')
    .select('*')
    .eq('id', id)
    .in('club_id', access.clubIds)
    .maybeSingle()
  if (!row) notFound()

  const schema = templateRowToSchema(row)

  const { data: club } = await db
    .from('clubs')
    .select('default_poster_template_id')
    .eq('id', row.club_id)
    .single()
  const isClubDefault = club?.default_poster_template_id === id

  let initialPreview: string | null = null
  try {
    const buffer = await renderPosterFromTemplate({
      schema,
      title: 'Lørdagskveld på Latter',
      dateText: 'lørdag 27. juni',
      timeText: 'kl. 20:00',
      venue: 'Latter, Aker Brygge — Oslo',
      headliners: [{ name: 'Åsleik Engmark', profileImageUrl: null, roleName: 'Headliner' }],
      supporting: [
        { name: 'Øystein Bråthen', profileImageUrl: null, roleName: null },
        { name: 'Mette Sørås', profileImageUrl: null, roleName: null },
      ],
    })
    initialPreview = `data:image/png;base64,${buffer.toString('base64')}`
  } catch {
    initialPreview = null
  }

  return (
    <div>
      <AdminHeader
        title="Rediger plakatmal"
        description="Dra feltene på plass. Tekst og logoer blir alltid skarpe – de bygges med ekte fonter, ikke av AI."
      />
      <div className="space-y-4 p-6">
        <Link href="/admin-app/min-klubb" className="text-xs text-muted-foreground hover:text-foreground">
          ← Tilbake til branding
        </Link>
        <PosterTemplateEditor
          templateId={id}
          initialName={row.name}
          initialSchema={schema}
          plateUrl={row.plate_url ?? row.source_poster_url}
          status={row.status}
          isClubDefault={isClubDefault}
          initialPreviewDataUrl={initialPreview}
          saveAction={savePosterTemplateAction}
          confirmAction={confirmPosterTemplateAction}
          previewAction={renderTemplatePreviewAction}
        />
      </div>
    </div>
  )
}
