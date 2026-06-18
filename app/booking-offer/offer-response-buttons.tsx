'use client'

import { useFormStatus } from 'react-dom'
import { publicAcceptOfferAction, publicDeclineOfferAction } from './[token]/actions'

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]"
    />
  )
}

function SubmitButton({
  className,
  label,
  pendingLabel,
}: {
  className: string
  label: string
  pendingLabel: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} disabled:cursor-progress disabled:opacity-80`}
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-2">
          <Spinner />
          {pendingLabel}
        </span>
      ) : (
        label
      )}
    </button>
  )
}

export function OfferResponseButtons({ token }: { token: string }) {
  return (
    <div className="space-y-3">
      <form action={publicAcceptOfferAction}>
        <input type="hidden" name="token" value={token} />
        <SubmitButton
          className="w-full border-2 border-zinc-950 bg-[#b83224] px-4 py-3 font-bold text-white shadow-[4px_4px_0_#18181b] transition hover:bg-[#9f2d21]"
          label="Ja, jeg tar spotten"
          pendingLabel="Sender svar…"
        />
      </form>
      <form action={publicDeclineOfferAction}>
        <input type="hidden" name="token" value={token} />
        <SubmitButton
          className="w-full border-2 border-zinc-950 bg-transparent px-4 py-3 text-sm font-bold transition hover:bg-zinc-950 hover:text-white"
          label="Nei, det passer ikke"
          pendingLabel="Sender svar…"
        />
      </form>
    </div>
  )
}
