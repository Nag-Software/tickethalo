'use client'

import { Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * Forklaringen som ikke trenger å stå framme.
 *
 * En admin-side leses av folk som har vært der før. Avsnittet som lærte dem
 * hvordan noe virker den første gangen, står i veien de neste hundre — men
 * det kan ikke bare slettes, for den hundre og første gangen er det noen ny
 * som sitter der.
 *
 * Derfor en (i): teksten er ett klikk unna når den trengs, og null piksler
 * når den ikke gjør det. Det som må leses hver gang hører ikke hjemme her.
 */
export function InfoHint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Info className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="gap-2 text-sm leading-relaxed">
        <p className="font-medium">{label}</p>
        <div className="text-muted-foreground [&_p+p]:mt-2">{children}</div>
      </PopoverContent>
    </Popover>
  )
}
