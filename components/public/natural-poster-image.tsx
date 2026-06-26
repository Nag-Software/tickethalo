import Image from 'next/image'

type NaturalPosterImageProps = {
  src: string
  alt: string
  preload?: boolean
  sizes: string
  className?: string
}

// Posters render in a fixed 2:3 box with object-contain letterboxing. Using a
// fixed aspect ratio — instead of measuring the image onLoad and snapping the
// container — removes a guaranteed layout shift on the LCP poster: template
// posters are deterministically 1024×1536 (2:3), and arbitrary uploads simply
// letterbox without cropping. No client state, so this stays a server component.
export function NaturalPosterImage({ src, alt, preload = false, sizes, className }: NaturalPosterImageProps) {
  return (
    <div className={className} style={{ aspectRatio: 2 / 3 }}>
      <Image
        src={src}
        alt={alt}
        fill
        preload={preload}
        sizes={sizes}
        className="object-contain"
      />
    </div>
  )
}
