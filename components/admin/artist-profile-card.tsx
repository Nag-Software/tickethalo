import Image from 'next/image'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatLanguageSummary } from '@/lib/languages'
import { shouldBypassImageOptimization } from '@/lib/utils'
import type { Artist } from '@/types/database'

/**
 * Komikerens egne opplysninger, slik hen har oppgitt dem — og bare til å se på.
 *
 * Dette kortet kunne redigeres av klubbadmin før. Navn, e-post, telefon,
 * kjønn, bio og lenker er komikerens egne, og skal endres av hen selv i
 * artist-portalen. En booker som retter noe her ville rettet det for alle
 * klubber samtidig, uten at komikeren visste om det.
 *
 * Klubbens egen mening om komikeren — roller, energi, notater, flagg — ligger
 * i «Booking profile»-kortet og lagres per klubb. Se migrasjon 043.
 */
export function ArtistProfileCard({ artist }: { artist: Artist }) {
  const socialLinks = Object.entries(artist.social_links ?? {}).filter(([, url]) => url)

  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Submitted profile</CardTitle>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Artist-managed
        </span>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-3 sm:gap-4">
          {artist.profile_image_url && (
            <div className="flex w-24 shrink-0 flex-col gap-1.5 sm:w-28">
              <Image
                src={artist.profile_image_url}
                alt={artist.full_name}
                width={224}
                height={288}
                sizes="(max-width: 640px) 96px, 112px"
                unoptimized={shouldBypassImageOptimization(artist.profile_image_url)}
                className="aspect-[4/5] w-full rounded-lg object-cover"
              />
              {/* En vanlig lenke, ikke `next/link`: svaret er en fil, ikke en side.
                  Filnavnet settes av ruten — se `lib/artist-photo.ts`. */}
              <Button variant="outline" size="xs" className="w-full" asChild>
                <a href={`/admin-app/artists/${artist.id}/photo`} download>
                  <Download data-icon="inline-start" />
                  Download
                </a>
              </Button>
            </div>
          )}

          <div className="min-w-0 flex-1">
            <dl className="grid grid-cols-1 gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
              <Row label="Full name" value={artist.full_name} />
              <Row label="Email" value={artist.email} />
              <Row label="Phone" value={artist.phone} />
              <Row label="Languages" value={formatLanguageSummary(artist.languages)} />
            </dl>

            <div className="mt-3 border-t pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Bio
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-snug">
                {artist.bio || <em className="not-italic text-muted-foreground">Not filled in.</em>}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Social
              </p>
              <div className="flex flex-wrap gap-x-2.5 gap-y-1">
                {socialLinks.length > 0 ? (
                  socialLinks.map(([key, url]) => (
                    <a
                      key={key}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-primary underline underline-offset-2"
                    >
                      {key}
                    </a>
                  ))
                ) : (
                  <em className="not-italic text-xs text-muted-foreground">None.</em>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] leading-none text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words leading-tight">
        {value ? value : <em className="not-italic text-muted-foreground">—</em>}
      </dd>
    </div>
  )
}
