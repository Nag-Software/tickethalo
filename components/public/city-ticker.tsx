'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const CITIES = ['Oslo', 'London', 'Copenhagen', 'New York']
const INTERVAL = 2600

/**
 * The city that rolls through the headline.
 *
 * The width used to be locked to the longest city name via an invisible
 * "Stavanger", which produced a wide pill with a lot of dead space around
 * "Oslo". Now every name is measured and the width is animated — the pill
 * tightens around the city instead of waiting for the longest one.
 *
 * Two details that must stay exactly as they are:
 *   - the measuring element sits outside the `overflow: hidden` element,
 *     otherwise it is constrained by the width we just set and the
 *     measurement lags one city behind (the text got clipped mid-"Trondheim")
 *   - the measuring element has `w-max`, so the width is the text's own width
 *     rather than being shrunk to whatever space happens to be free
 */
export function CityTicker() {
  const [index, setIndex] = useState(0)
  const [width, setWidth] = useState<number | undefined>(undefined)
  const measureRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % CITIES.length), INTERVAL)
    return () => clearInterval(timer)
  }, [])

  // Measured before paint. ResizeObserver catches font loading and
  // breakpoints, both of which change the text width after the first measure.
  useLayoutEffect(() => {
    const node = measureRef.current
    if (!node) return

    const sync = () => setWidth(node.getBoundingClientRect().width)
    sync()

    const observer = new ResizeObserver(sync)
    observer.observe(node)
    return () => observer.disconnect()
  }, [index])

  return (
    <span className="relative inline-block align-bottom">
      <span
        ref={measureRef}
        aria-hidden
        className="invisible absolute left-0 top-0 w-max whitespace-nowrap"
      >
        {CITIES[index]}
      </span>

      <span
        // 400 ms: the width settles before the text reaches full opacity at 16% of
        // 2600 ms, so a longer city name is never shown while the pill is still growing.
        className="block overflow-hidden transition-[width] duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ width: width !== undefined ? `${width}px` : undefined }}
      >
        <span key={index} className="animate-city-roll block whitespace-nowrap">
          {CITIES[index]}
        </span>
      </span>
    </span>
  )
}
