import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminHeader } from '@/components/admin/admin-header'
import { PosterTemplateEditor } from '@/components/admin/poster-template-editor'
import { getClubAccess } from '@/lib/club-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { templateRowToSchema } from '@/lib/poster-template'
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
  const [{ data: row }, { data: defaultClubs }] = await Promise.all([
    db
      .from('poster_templates')
      .select('*')
      .eq('id', id)
      .in('club_id', access.clubIds)
      .maybeSingle(),
    db.from('clubs').select('id').eq('default_poster_template_id', id),
  ])
  if (!row) notFound()

  const schema = templateRowToSchema(row)
  const isClubDefault = (defaultClubs ?? []).some((club) => club.id === row.club_id)

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
          initialPreviewDataUrl={null}
          saveAction={savePosterTemplateAction}
          confirmAction={confirmPosterTemplateAction}
          previewAction={renderTemplatePreviewAction}
        />
      </div>
    </div>
  )
}
