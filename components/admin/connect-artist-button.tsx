'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ARTIST_ROLE_OPTIONS, normalizeArtistRoleList } from '@/lib/artist-roles'
import { connectArtistAction } from '@/app/admin-app/(protected)/discover/actions'

/**
 * Å knytte til seg en komiker er også å bestemme hva man booker hen som.
 *
 * Rollene er klubbens egne (`club_artists.category`, migrasjon 043), så de
 * må velges her — ikke arves stilltiende fra komikerens egen beskrivelse.
 * Den beskrivelsen er likevel et fornuftig utgangspunkt, så avkryssingen
 * starter der og kan endres.
 */
export function ConnectArtistButton({
  artistId,
  artistName,
  suggestedRoles,
  className,
}: {
  artistId: string
  artistName: string
  /** Komikerens egen beskrivelse — bare et forslag. */
  suggestedRoles: string[] | null
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [roles, setRoles] = useState<string[]>(() => normalizeArtistRoleList(suggestedRoles))
  const [isPending, startTransition] = useTransition()

  function toggle(role: string) {
    setRoles((current) =>
      current.includes(role) ? current.filter((value) => value !== role) : [...current, role],
    )
  }

  function submit() {
    if (roles.length === 0) return

    startTransition(async () => {
      const formData = new FormData()
      formData.set('artist_id', artistId)
      for (const role of roles) formData.append('category', role)

      const result = await connectArtistAction(formData)
      if (result?.error) {
        toast.error(result.error)
        return
      }

      toast.success(`${artistName} added to your club.`)
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" className={className}>
          Connect to my club
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <p className="text-xs font-semibold">Book {artistName} as</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Your club&apos;s own roles for this comedian. Only these are matched against your show
          requirements.
        </p>

        <div className="mt-3 flex flex-col gap-1">
          {ARTIST_ROLE_OPTIONS.map((role) => (
            <label
              key={role.value}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={roles.includes(role.value)}
                onChange={() => toggle(role.value)}
                className="size-3.5"
              />
              {role.label}
            </label>
          ))}
        </div>

        <Button
          type="button"
          onClick={submit}
          disabled={isPending || roles.length === 0}
          className="mt-3 w-full"
          size="sm"
        >
          {roles.length === 0 ? 'Pick at least one role' : 'Add to club'}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
