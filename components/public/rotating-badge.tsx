'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'

interface Props {
  text: string
  onClick?: () => void
  showIcon?: boolean
  icon?: React.ReactNode
  className?: string
  /** Skjul merket når man har scrollet forbi dette punktet. Det er et scroll-hint —
   *  når du først har scrollet har det gjort jobben, og det kolliderer med filterlinjen. */
  hideAfter?: number
}

export function RotatingBadge({ text, onClick, showIcon = false, icon, className = 'fixed top-4 right-4 md:top-8 md:right-8', hideAfter }: Props) {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (hideAfter === undefined) return
    const onScroll = () => setHidden(window.scrollY > hideAfter)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [hideAfter])

  const getRepetitions = (t: string) => {
    if (t.length <= 4) return 8
    if (t.length <= 6) return 6
    return 5
  }

  const reps = getRepetitions(text)
  const offset = 100 / reps

  return (
    <div
      className={`${className} w-[60px] h-[60px] md:w-[72px] md:h-[72px] lg:w-[154px] lg:h-[154px] z-40 animate-fade-in transition-opacity duration-300 ${hidden ? 'opacity-0 pointer-events-none' : 'opacity-100'} ${onClick ? 'cursor-pointer' : ''}`}
      aria-hidden={hidden}
      style={{ animationDelay: '0.2s', animationFillMode: 'both' }}
      onClick={onClick}
    >
      <div className="w-full h-full relative animate-badge-spin">
        <Image src="/badge.png" alt="Badge" fill className="object-contain" />
        <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full">
          <defs>
            <path id="circlePath" d="M 100, 30 a 70,70 0 1,1 0,140 a 70,70 0 1,1 0,-140" />
          </defs>
          {Array.from({ length: reps }).map((_, i) => (
            <text key={i} className="text-[16px] font-bold uppercase" fill="black">
              <textPath href="#circlePath" startOffset={`${i * offset}%`}>
                {text}
              </textPath>
            </text>
          ))}
        </svg>
      </div>
      {showIcon && icon && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {icon}
        </div>
      )}
    </div>
  )
}
