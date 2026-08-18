'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const Logo = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14" className="w-[15px] h-[15px] text-white">
    <g id="smiley-smirk">
      <path
        id="Subtract"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.5"
        fillRule="evenodd"
        d="M1.83645 1.83645C3.06046 0.612432 4.82797 0 7 0s3.9395 0.612432 5.1636 1.83645C13.3876 3.06046 14 4.82797 14 7s-0.6124 3.9395-1.8364 5.1636C10.9395 13.3876 9.17203 14 7 14s-3.93954-0.6124-5.16355-1.8364C0.612432 10.9395 0 9.17203 0 7s0.612432-3.93954 1.83645-5.16355ZM5.0769 4.98816c0-0.34518-0.27982-0.625-0.625-0.625-0.34517 0-0.625 0.27982-0.625 0.625v0.7c0 0.34518 0.27983 0.625 0.625 0.625 0.34518 0 0.625-0.27982 0.625-0.625v-0.7Zm5.0962 0c0-0.34518-0.27983-0.625-0.625-0.625-0.34518 0-0.625 0.27982-0.625 0.625v0.7c0 0.34518 0.27982 0.625 0.625 0.625 0.34517 0 0.625-0.27982 0.625-0.625v-0.7Zm0.1787 2.42929c0.3217 0.12505 0.4812 0.48724 0.3561 0.80897-0.2805 0.72182-0.75537 1.29603-1.40641 1.68306-0.64416 0.38292-1.4264 0.56282-2.30149 0.56282-0.34518 0-0.625-0.2798-0.625-0.62501 0-0.34518 0.27982-0.625 0.625-0.625 0.7083 0 1.25628-0.14564 1.66273-0.38728 0.39956-0.23753 0.69571-0.58697 0.88012-1.06143 0.12505-0.32173 0.48725-0.48117 0.80895-0.35613Z"
        clipRule="evenodd"
      />
    </g>
  </svg>
)

const navLinks = [
  { href: '/events', label: 'EVENTER' },
  { href: '/artists', label: 'KOMIKERE' },
  { href: '/artist-app/login', label: 'PORTAL' },
]

/**
 * @param tone Tonen på sidebakgrunnen bak headeren — avgjør hvilken farge
 *             baren får når den setter seg fast ved scroll.
 */
export function PublicHeader({ transparent, tone = 'dark' }: { transparent?: boolean; tone?: 'dark' | 'light' }) {
  void transparent
  const [open, setOpen] = useState(false)
  const [stuck, setStuck] = useState(false)

  // Navigasjonen svever over innholdet og kolliderer med lyse plakater.
  // Når vi har scrollet forbi heroen legger den seg inntil toppen med bakgrunn.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 64)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <div
        aria-hidden
        className={cn(
          'fixed inset-x-0 top-0 z-[1999] h-[66px] backdrop-blur-md transition-opacity duration-300',
          tone === 'light'
            ? 'border-b border-black/10 bg-white/80'
            : 'border-b border-white/10 bg-[#08070a]/80',
          stuck ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />
      <nav
        className={cn(
          'fixed left-4 z-[2000] flex items-center gap-0 animate-fade-in transition-[top] duration-300 md:left-8',
          stuck ? 'top-4' : 'top-8'
        )}
        style={{ animationFillMode: 'both' }}
      >
        {/* Logo */}
        <Link href="/" className="flex items-stretch h-[34px] border border-black flex-shrink-0 group">
          <div className="w-[34px] bg-black flex items-center justify-center">
            <Logo />
          </div>
          <div className="hidden! sm:flex! pr-2 bg-black flex items-center border-l border-black/15 transition-colors">
            <span className="text-[12px] font-semibold tracking-[0.08em] text-white transition-colors">humor.events</span>
          </div>
        </Link>

        {/* Desktop nav links */}
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="relative overflow-hidden bg-white text-black h-[34px] px-3 hidden md:flex items-center text-[11px] font-medium uppercase border-l-0 border border-black leading-none group"
          >
            <span className="relative z-10">{link.label}</span>
            <span className="absolute inset-0 bg-[#FA76FF] translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          </Link>
        ))}

        {/* Mobile menu button */}
        <button
          onClick={() => setOpen(true)}
          aria-label="Åpne meny"
          className="relative overflow-hidden bg-white text-black h-[34px] w-[34px] flex md:hidden items-center justify-center border-l-0 border border-black group"
        >
          <span className="relative z-10 flex flex-col gap-[5px] items-center justify-center">
            <span className="block w-[14px] h-[1.5px] bg-black" />
            <span className="block w-[14px] h-[1.5px] bg-black" />
            <span className="block w-[14px] h-[1.5px] bg-black" />
          </span>
          <span className="absolute inset-0 bg-[#FA76FF] translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
        </button>
      </nav>

      {/* Mobile full-screen overlay */}
      <div
        className={`fixed inset-0 z-[3000] flex flex-col bg-black transition-all duration-500 ease-in-out ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden={!open}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 pt-8">
          {/* Logo in overlay */}
          <Link href="/" onClick={() => setOpen(false)} className="flex items-stretch h-[34px] border border-white/20 flex-shrink-0">
            <div className="w-[34px] bg-white/10 flex items-center justify-center">
              <Logo />
            </div>
            <div className="px-2 flex items-center border-l border-white/10">
              <span className="text-[12px] font-semibold tracking-[0.08em] text-white">humor.events</span>
            </div>
          </Link>

          {/* Close button */}
          <button
            onClick={() => setOpen(false)}
            aria-label="Lukk meny"
            className="relative overflow-hidden h-[34px] w-[34px] flex items-center justify-center border border-white/20 group"
          >
            <span className="relative z-10">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-white">
                <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </span>
            <span className="absolute inset-0 bg-[#FA76FF] translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          </button>
        </div>

        {/* Nav items */}
        <div className="flex-1 flex flex-col justify-center px-4 gap-0">
          {navLinks.map((link, i) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={`relative overflow-hidden border-b border-white/10 group transition-all duration-500 ${
                open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
              style={{ transitionDelay: open ? `${100 + i * 80}ms` : '0ms' }}
            >
              <div className="relative z-10 py-6 flex items-center justify-between">
                <span className="text-[40px] font-semibold tracking-tight text-white leading-none">{link.label}</span>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-white/30 group-hover:text-black transition-colors duration-300">
                  <path d="M4 10H16M16 10L10 4M16 10L10 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span className="absolute inset-0 bg-[#FA76FF] translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-300 ease-out" />
            </Link>
          ))}
        </div>

        {/* Footer decoration */}
        <div
          className={`px-4 pb-8 transition-all duration-500 ${open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
          style={{ transitionDelay: open ? '400ms' : '0ms' }}
        >
          <p className="text-[11px] uppercase tracking-[0.15em] text-white/20">humor.events — Norges morsomste kvelder</p>
        </div>
      </div>
    </>
  )
}
