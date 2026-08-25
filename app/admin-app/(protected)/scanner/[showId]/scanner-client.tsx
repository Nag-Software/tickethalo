'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { checkInByCode, uncheckIn, getTicketsForShow, type TicketRow } from '../actions'
import { extractTicketCode, formatTicketCode } from '@/lib/tickets'

type ScanResult = {
  tone: 'success' | 'already' | 'error'
  title: string
  subtitle: string
}

export function ScannerClient({
  showId,
  showTitle,
  showInfo,
  initialTickets,
}: {
  showId: string
  showTitle: string
  showInfo: string
  initialTickets: TicketRow[]
}) {
  const [activeTab, setActiveTab] = useState<'scan' | 'list'>('scan')
  const [tickets, setTickets] = useState(initialTickets)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [manualCode, setManualCode] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const resultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCodeRef = useRef('')
  const lastCodeTimeRef = useRef(0)
  const processingRef = useRef(false)

  const checkedIn = tickets.filter(t => t.status === 'used').length
  const total = tickets.length
  const pct = total > 0 ? Math.round((checkedIn / total) * 100) : 0

  // ── Show result overlay ─────────────────────────────────────────────────
  const showScanResult = useCallback((result: ScanResult) => {
    setScanResult(result)
    if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current)
    if (result.tone === 'success') {
      resultTimeoutRef.current = setTimeout(() => setScanResult(null), 2500)
    }
  }, [])

  // ── Process a scanned / entered code ───────────────────────────────────
  const processCode = useCallback(
    async (code: string) => {
      if (processingRef.current) return
      // QR-koden inneholder en verifiseringslenke; koden hentes ut av den.
      // Den er heksadesimal og skal ikke gjøres om til store bokstaver.
      const normalized = extractTicketCode(code)
      if (!normalized) return

      // Debounce: ignore same code within 3 s
      const now = Date.now()
      if (normalized === lastCodeRef.current && now - lastCodeTimeRef.current < 3000) return
      lastCodeRef.current = normalized
      lastCodeTimeRef.current = now

      processingRef.current = true
      setIsProcessing(true)
      try {
        const result = await checkInByCode(showId, normalized)

        if ('notFound' in result) {
          showScanResult({ tone: 'error', title: 'Not found', subtitle: `Unknown code: ${normalized}` })
        } else if ('alreadyUsed' in result) {
          const time = result.checkedInAt
            ? new Date(result.checkedInAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
            : ''
          showScanResult({
            tone: 'already',
            title: 'Already checked in',
            subtitle: [result.holderName, time && `Checked in at ${time}`].filter(Boolean).join(' · '),
          })
        } else if ('invalid' in result) {
          showScanResult({ tone: 'error', title: 'Invalid ticket', subtitle: result.status })
        } else if ('ok' in result) {
          const name = result.holderName ?? result.buyerName ?? result.buyerEmail ?? result.ticketCode
          showScanResult({ tone: 'success', title: '✓ Let them in!', subtitle: name })
          setTickets(prev =>
            prev.map(t =>
              t.id === result.ticketId
                ? { ...t, status: 'used', checked_in_at: new Date().toISOString() }
                : t
            )
          )
        }
      } finally {
        processingRef.current = false
        setIsProcessing(false)
      }
    },
    [showScanResult]
  )

  // ── Start camera ────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    if (!videoRef.current) return
    setCameraError(null)
    setIsScanning(false)
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser')
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 100 })

      // Prefer rear camera
      let deviceId: string | undefined
      try {
        const devices = await BrowserQRCodeReader.listVideoInputDevices()
        if (devices.length) {
          const rear = devices.find(d => /back|rear|environment|bak/i.test(d.label))
          deviceId = rear?.deviceId ?? devices[devices.length - 1]?.deviceId
        }
      } catch {
        // Proceed without device selection
      }

      if (!videoRef.current) return

      const controls = await reader.decodeFromVideoDevice(deviceId, videoRef.current, result => {
        if (result) processCode(result.getText())
      })
      controlsRef.current = controls
      setIsScanning(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      if (/Permission|NotAllowed|NotFound/i.test(msg)) {
        setCameraError('Camera access was denied. Open your browser settings, allow camera access and reload the page.')
      } else {
        setCameraError(`The camera could not be started. ${msg}`)
      }
    }
  }, [processCode])

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    setIsScanning(false)
  }, [])

  // Start/stop camera based on active tab
  useEffect(() => {
    if (activeTab === 'scan') {
      startCamera()
    } else {
      stopCamera()
    }
    return () => stopCamera()
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current)
    }
  }, [])

  // ── Manual form submit ──────────────────────────────────────────────────
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualCode.trim()) return
    processCode(manualCode)
    setManualCode('')
  }

  // ── Manual uncheck ──────────────────────────────────────────────────────
  const handleUncheck = async (ticket: TicketRow) => {
    setTickets(prev =>
      prev.map(t =>
        t.id === ticket.id ? { ...t, status: 'valid', checked_in_at: null } : t
      )
    )
    await uncheckIn(ticket.id, showId)
  }

  // ── Manual check-in from list ───────────────────────────────────────────
  const handleManualCheckIn = (ticket: TicketRow) => {
    processCode(ticket.ticket_code)
  }

  // ── Refresh guest list from server ──────────────────────────────────────
  const refreshList = async () => {
    setIsRefreshing(true)
    try {
      const fresh = await getTicketsForShow(showId)
      setTickets(fresh)
    } finally {
      setIsRefreshing(false)
    }
  }

  // ── Filtered + sorted guest list ────────────────────────────────────────
  const filteredTickets = tickets
    .filter(t => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      return (
        t.ticket_code.toLowerCase().includes(q) ||
        (t.holder_name ?? '').toLowerCase().includes(q) ||
        (t.buyer_name ?? '').toLowerCase().includes(q) ||
        (t.buyer_email ?? '').toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      // Valid (not checked in) first
      if (a.status === 'valid' && b.status !== 'valid') return -1
      if (a.status !== 'valid' && b.status === 'valid') return 1
      return 0
    })

  const resultBg =
    scanResult?.tone === 'success'
      ? 'bg-emerald-500'
      : scanResult?.tone === 'already'
      ? 'bg-amber-500'
      : 'bg-red-600'

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col select-none">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <Link
          href="/admin-app/scanner"
          className="text-zinc-400 hover:text-white transition-colors text-sm active:text-zinc-300"
        >
          ← Pick show
        </Link>
        <div className="text-center min-w-0 flex-1 mx-3">
          <div className="text-sm font-bold truncate">{showTitle}</div>
          <div className="text-[11px] text-zinc-500 truncate">{showInfo}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold tabular-nums text-emerald-400 leading-none">{checkedIn}</div>
          <div className="text-[10px] text-zinc-600">/ {total} in</div>
        </div>
      </header>

      {/* ── Tabs ── */}
      <div className="flex bg-zinc-900 border-b border-zinc-800 shrink-0">
        <button
          onClick={() => setActiveTab('scan')}
          className={`flex-1 py-3 text-sm font-semibold transition-colors ${
            activeTab === 'scan'
              ? 'text-white border-b-2 border-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          📷 Scanner
        </button>
        <button
          onClick={() => setActiveTab('list')}
          className={`flex-1 py-3 text-sm font-semibold transition-colors relative ${
            activeTab === 'list'
              ? 'text-white border-b-2 border-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          👥 Guest list
          {checkedIn > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold">
              {checkedIn}
            </span>
          )}
        </button>
      </div>

      {/* ═══════════════════════════════ SCANNER TAB ══════════════════════════════ */}
      {activeTab === 'scan' && (
        <div className="flex-1 flex flex-col">

          {/* Camera viewport */}
          <div className="relative bg-black overflow-hidden" style={{ minHeight: '56vw', maxHeight: '65vh' }}>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
              autoPlay
            />

            {/* QR frame overlay */}
            {isScanning && !scanResult && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                {/* Dark vignette */}
                <div className="absolute inset-0 bg-black/40" style={{
                  maskImage: 'radial-gradient(ellipse 58% 58% at 50% 50%, transparent 0%, black 100%)',
                  WebkitMaskImage: 'radial-gradient(ellipse 58% 58% at 50% 50%, transparent 0%, black 100%)',
                }} />
                {/* Frame corners */}
                <div className="relative size-56 z-10">
                  {(['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0', 'bottom-0 right-0'] as const).map((pos, i) => {
                    const flipX = pos.includes('right') ? 'scaleX(-1)' : ''
                    const flipY = pos.includes('bottom') ? 'scaleY(-1)' : ''
                    const transform = [flipX, flipY].filter(Boolean).join(' ') || undefined
                    return (
                      <div key={i} className={`absolute ${pos} size-9`} style={{ transform }}>
                        <div className="absolute top-0 left-0 w-9 h-0.5 bg-white rounded-full" />
                        <div className="absolute top-0 left-0 w-0.5 h-9 bg-white rounded-full" />
                      </div>
                    )
                  })}
                  {isProcessing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-sm">
                      <div className="size-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Scan result overlay — tappable to dismiss */}
            {scanResult && (
              <div
                className={`absolute inset-0 flex flex-col items-center justify-center ${resultBg} cursor-pointer active:opacity-90 transition-opacity`}
                onClick={() => {
                  if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current)
                  setScanResult(null)
                }}
              >
                <div className="text-7xl font-black mb-2">
                  {scanResult.tone === 'success' ? '✓' : scanResult.tone === 'already' ? '⚠' : '✗'}
                </div>
                <div className="text-2xl font-bold text-center px-6">{scanResult.title}</div>
                {scanResult.subtitle && (
                  <div className="text-base mt-2 text-white/80 text-center px-6 max-w-xs">{scanResult.subtitle}</div>
                )}
                {scanResult.tone !== 'success' && (
                  <div className="mt-5 text-xs text-white/50">Tap to dismiss</div>
                )}
              </div>
            )}

            {/* Camera loading */}
            {!isScanning && !cameraError && !scanResult && (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                <div className="size-9 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Camera error */}
            {!isScanning && cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 p-6 text-center gap-4">
                <div className="text-4xl">📷</div>
                <p className="text-sm text-zinc-300 max-w-xs">{cameraError}</p>
                <button
                  onClick={startCamera}
                  className="px-5 py-2.5 rounded-xl bg-white text-black text-sm font-bold hover:bg-zinc-100 active:bg-zinc-200 transition-colors"
                >
                  Try again
                </button>
              </div>
            )}
          </div>

          {/* Manual input + progress */}
          <div className="p-4 space-y-4 bg-zinc-900">
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              {/* Koden er åtte tegn og vises som XXXX-XXXX. Feltet setter
                  bindestreken selv, så den som taster slipper å tenke på den —
                  og serveren stripper den uansett. */}
              <input
                type="text"
                value={manualCode}
                onChange={e => setManualCode(formatTicketCode(extractTicketCode(e.target.value.toUpperCase())))}
                placeholder="A1B2-C3D4"
                maxLength={40}
                inputMode="text"
                className="flex-1 bg-zinc-800 text-white placeholder-zinc-600 rounded-xl px-4 py-3.5 text-base font-mono tracking-[0.14em] focus:outline-none focus:ring-2 focus:ring-white/25 border border-zinc-700"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
              <button
                type="submit"
                disabled={!manualCode.trim() || isProcessing}
                className="px-5 py-3.5 rounded-xl bg-white text-black text-sm font-bold disabled:opacity-30 hover:bg-zinc-100 active:bg-zinc-200 transition-colors shrink-0"
              >
                Check
              </button>
            </form>

            {/* Progress bar */}
            {total > 0 && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>{checkedIn} of {total} checked in</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════ GUEST LIST TAB ═══════════════════════════ */}
      {activeTab === 'list' && (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Search + refresh */}
          <div className="flex gap-2 px-3 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
            <input
              type="search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search name, email or ticket code…"
              className="flex-1 bg-zinc-800 text-white placeholder-zinc-600 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-white/25 border border-zinc-700"
            />
            <button
              onClick={refreshList}
              disabled={isRefreshing}
              className="px-3.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white text-lg font-medium transition-colors disabled:opacity-40 shrink-0"
              title="Refresh list from the server"
            >
              {isRefreshing
                ? <span className="inline-block size-4 border border-zinc-400 border-t-transparent rounded-full animate-spin align-middle" />
                : '↻'}
            </button>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
            {[
              { label: 'Total', value: total, color: 'text-white' },
              { label: 'Checked in', value: checkedIn, color: 'text-emerald-400' },
              { label: 'Not arrived yet', value: total - checkedIn, color: 'text-zinc-400' },
            ].map(s => (
              <div key={s.label} className="text-center py-3">
                <div className={`text-2xl font-black tabular-nums leading-none ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-zinc-600 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Ticket list */}
          <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/60">
            {filteredTickets.map(ticket => (
              <div
                key={ticket.id}
                className={`flex items-center gap-3 px-4 py-3.5 ${
                  ticket.status === 'used' ? 'bg-emerald-950/25' : ''
                }`}
              >
                {/* Status dot */}
                <div
                  className={`size-9 rounded-full shrink-0 flex items-center justify-center text-base font-bold transition-colors ${
                    ticket.status === 'used'
                      ? 'bg-emerald-600 text-white'
                      : ticket.status === 'valid'
                      ? 'bg-zinc-800 text-zinc-500'
                      : 'bg-red-950 text-red-500'
                  }`}
                >
                  {ticket.status === 'used' ? '✓' : ticket.status === 'valid' ? '·' : '✗'}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate leading-tight">
                    {ticket.holder_name ?? ticket.buyer_name ?? ticket.buyer_email ?? 'Unknown guest'}
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate mt-0.5">
                    <span className="font-mono tracking-wider">{formatTicketCode(ticket.ticket_code)}</span>
                    {ticket.checked_in_at && (
                      <span className="ml-2 text-emerald-600 font-sans">
                        · at{' '}
                        {new Date(ticket.checked_in_at).toLocaleTimeString('en-GB', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                  </div>
                  {/* Kjøperen vises når billetten gjelder en annen — det er
                      slik en gruppe på fire finner hverandre i lista. */}
                  {ticket.holder_name && ticket.buyer_name && ticket.holder_name !== ticket.buyer_name && (
                    <div className="text-[10px] text-zinc-600 truncate">Bought by {ticket.buyer_name}</div>
                  )}
                  {!ticket.holder_name && ticket.buyer_name && ticket.buyer_email && (
                    <div className="text-[10px] text-zinc-600 truncate">{ticket.buyer_email}</div>
                  )}
                </div>

                {/* Action button */}
                {ticket.status === 'used' ? (
                  <button
                    onClick={() => handleUncheck(ticket)}
                    className="shrink-0 text-xs px-3 py-2 rounded-lg bg-zinc-800 text-zinc-500 hover:text-white hover:bg-zinc-700 active:bg-zinc-600 transition-colors border border-zinc-700"
                  >
                    Undo
                  </button>
                ) : ticket.status === 'valid' ? (
                  <button
                    onClick={() => handleManualCheckIn(ticket)}
                    disabled={isProcessing}
                    className="shrink-0 text-xs px-3 py-2 rounded-lg bg-emerald-900 text-emerald-300 hover:bg-emerald-800 active:bg-emerald-700 transition-colors disabled:opacity-40 border border-emerald-800"
                  >
                    In ✓
                  </button>
                ) : (
                  <span className="shrink-0 text-xs text-zinc-600 capitalize">{ticket.status}</span>
                )}
              </div>
            ))}

            {filteredTickets.length === 0 && (
              <div className="text-center py-16 text-zinc-600 text-sm">
                {searchQuery ? 'No matches for that search' : 'No tickets registered yet'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
