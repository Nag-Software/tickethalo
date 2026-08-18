'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const CITIES = ['Bergen', 'Oslo', 'Trondheim', 'Drammen', 'Stavanger']
const INTERVAL = 2600

/**
 * Byen som ruller gjennom overskriften.
 *
 * Tidligere låste vi bredden til det lengste bynavnet med en usynlig
 * «Stavanger», som ga en bred pille med mye dødt rom rundt «Oslo».
 * Nå måles hvert navn og bredden animeres — pillen strammer seg
 * rundt byen i stedet for å vente på den lengste.
 *
 * To detaljer som må stå som de står:
 *   - måleren ligger utenfor `overflow: hidden`-elementet, ellers
 *     begrenses den av bredden vi nettopp satte, og målingen henger
 *     igjen på forrige by (teksten ble klippet midt i «Trondheim»)
 *   - måleren har `w-max`, slik at bredden blir tekstens egen bredde
 *     og ikke krympes til det som tilfeldigvis er ledig plass
 */
export function CityTicker() {
  const [index, setIndex] = useState(0)
  const [width, setWidth] = useState<number | undefined>(undefined)
  const measureRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % CITIES.length), INTERVAL)
    return () => clearInterval(timer)
  }, [])

  // Måles før maling. ResizeObserver fanger opp skriftlasting og
  // brytepunkter, som begge endrer tekstbredden etter første måling.
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
        // 400 ms: bredden er ferdig før teksten når full opasitet på 16 % av
        // 2600 ms, så et lengre bynavn aldri vises mens pillen fortsatt vokser.
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
