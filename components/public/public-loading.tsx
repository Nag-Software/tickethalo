// Lightweight loading fallback shown during client navigation to data-backed public
// routes (which are dynamically rendered). The spinner respects prefers-reduced-motion
// via the global override in globals.css.
export function PublicLoading() {
  return (
    <div className="public-shell flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="size-10 animate-spin rounded-full border-2 border-border border-t-vipps-orange" />
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">Laster…</p>
      </div>
    </div>
  )
}
