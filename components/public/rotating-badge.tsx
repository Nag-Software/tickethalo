'use client'

import Image from 'next/image'

interface Props {
  text: string
  onClick?: () => void
  showIcon?: boolean
  icon?: React.ReactNode
  className?: string
  hideText?: boolean
  backgroundFill?: string
  backgroundStroke?: string
  textColor?: string
}

function buildScallopedPath(lobes = 20, outerRadius = 94, innerRadius = 84) {
  const center = 100
  let path = ''

  for (let index = 0; index < lobes; index += 1) {
    const startAngle = (index / lobes) * Math.PI * 2 - Math.PI / 2
    const peakAngle = startAngle + Math.PI / lobes
    const endAngle = startAngle + (Math.PI * 2) / lobes

    const startX = center + innerRadius * Math.cos(startAngle)
    const startY = center + innerRadius * Math.sin(startAngle)
    const peakX = center + outerRadius * Math.cos(peakAngle)
    const peakY = center + outerRadius * Math.sin(peakAngle)
    const endX = center + innerRadius * Math.cos(endAngle)
    const endY = center + innerRadius * Math.sin(endAngle)

    if (index === 0) {
      path = `M ${startX} ${startY}`
    }

    path += ` Q ${peakX} ${peakY} ${endX} ${endY}`
  }

  return `${path} Z`
}

export function RotatingBadge({
  text,
  onClick,
  showIcon = false,
  icon,
  className = 'fixed top-4 right-4 md:top-8 md:right-8',
  hideText = false,
  backgroundFill,
  backgroundStroke = 'black',
  textColor = 'black',
}: Props) {
  const getRepetitions = (t: string) => {
    if (t.length <= 4) return 8
    if (t.length <= 6) return 6
    return 5
  }

  const reps = getRepetitions(text)
  const offset = 100 / reps
  const scallopedPath = buildScallopedPath()

  return (
    <div
      className={`${className} w-[60px] h-[60px] md:w-[72px] md:h-[72px] lg:w-[154px] lg:h-[154px] z-40 animate-fade-in ${onClick ? 'cursor-pointer' : ''}`}
      style={{ animationDelay: '0.2s', animationFillMode: 'both' }}
      onClick={onClick}
    >
      <div className="w-full h-full relative" style={{ animation: 'spin 20s linear infinite' }}>
        {backgroundFill ? (
          <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <path d={scallopedPath} fill={backgroundFill} stroke={backgroundStroke} strokeWidth="2" />
          </svg>
        ) : (
          <Image src="/badge.png" alt="" fill className="object-contain" />
        )}
        {!hideText && text ? (
          <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full">
            <defs>
              <path id="circlePath" d="M 100, 30 a 70,70 0 1,1 0,140 a 70,70 0 1,1 0,-140" />
            </defs>
            {Array.from({ length: reps }).map((_, i) => (
              <text key={i} className="text-[16px] font-bold uppercase" fill={textColor}>
                <textPath href="#circlePath" startOffset={`${i * offset}%`}>
                  {text}
                </textPath>
              </text>
            ))}
          </svg>
        ) : null}
      </div>
      {showIcon && icon && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {icon}
        </div>
      )}
    </div>
  )
}
