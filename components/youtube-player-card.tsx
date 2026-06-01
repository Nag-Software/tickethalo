import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function YouTubePlayerCard({
  url,
  title = 'YouTube-video',
  description,
  className,
}: {
  url?: string | null
  title?: string
  description?: string
  className?: string
}) {
  const embedUrl = url ? getYouTubeEmbedUrl(url) : null

  return (
    <section className={cn('rounded-xl border bg-card p-5 space-y-4', className)}>
      <div>
        <h2 className="font-semibold text-sm">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>

      {embedUrl ? (
        <>
          <div className="overflow-hidden rounded-xl border bg-black">
            <div className="relative aspect-video w-full">
              <iframe
                src={embedUrl}
                title={title}
                allow="forms; scripts; same-origin; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            </div>
          </div>

          <Link
            href={url!}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            Åpne på YouTube <ArrowUpRight className="size-4" />
          </Link>
        </>
      ) : (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Ingen gyldig YouTube-video registrert ennå.
        </div>
      )}
    </section>
  )
}

function getYouTubeEmbedUrl(url: string) {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')

    if (host === 'youtu.be') {
      const videoId = parsed.pathname.split('/').filter(Boolean)[0]
      return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : null
    }

    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (parsed.pathname === '/watch') {
        const videoId = parsed.searchParams.get('v')
        return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : null
      }

      if (parsed.pathname.startsWith('/embed/')) {
        const videoId = parsed.pathname.split('/').filter(Boolean)[1]
        return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : null
      }

      if (parsed.pathname.startsWith('/shorts/')) {
        const videoId = parsed.pathname.split('/').filter(Boolean)[1]
        return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : null
      }
    }
  } catch {
    return null
  }

  return null
}