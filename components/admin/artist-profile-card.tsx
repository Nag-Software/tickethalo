import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatArtistRoleSummary } from '@/lib/artist-roles'
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
    <Card size="sm">
      <CardHeader>
        <CardTitle>Submitted profile</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 sm:flex-row">
          {artist.profile_image_url && (
            <Image
              src={artist.profile_image_url}
              alt={artist.full_name}
              width={224}
              height={288}
              sizes="(max-width: 640px) 100vw, 224px"
              unoptimized={shouldBypassImageOptimization(artist.profile_image_url)}
              className="h-64 w-full shrink-0 rounded-xl object-cover sm:h-56 sm:w-44 lg:h-72 lg:w-56"
            />
          )}

          <dl className="grid flex-1 grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <Row label="Full name" value={artist.full_name} />
            <Row label="Stage name" value={artist.stage_name} />
            <Row label="Email" value={artist.email} />
            <Row label="Phone" value={artist.phone} />
            <Row label="Describes themselves as" value={formatArtistRoleSummary(artist.category, '')} />
            <Row label="Languages" value={formatLanguageSummary(artist.languages)} />
          </dl>
        </div>

        <div>
          <p className="mb-1 text-xs text-muted-foreground">Bio</p>
          <p className="min-h-[1.5rem] whitespace-pre-wrap text-sm">
            {artist.bio || <em className="not-italic text-muted-foreground">Not filled in.</em>}
          </p>
        </div>

        <div>
          <p className="mb-1 text-xs text-muted-foreground">Social links</p>
          <div className="flex flex-wrap gap-2">
            {socialLinks.length > 0 ? (
              socialLinks.map(([key, url]) => (
                <a
                  key={key}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary underline underline-offset-2"
                >
                  {key}
                </a>
              ))
            ) : (
              <em className="not-italic text-xs text-muted-foreground">None.</em>
            )}
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          The comedian maintains these details in their own portal.
        </p>
      </CardContent>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">
        {value ? value : <em className="not-italic text-muted-foreground">—</em>}
      </dd>
    </div>
  )
}
