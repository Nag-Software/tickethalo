'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Check, ChevronsUpDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

type ClubSwitcherProps = {
  clubs: Array<{ id: string; name: string; city: string | null; logo_url: string | null }>
  selectedClubId: string | null
}

function getNextPath(pathname: string) {
  if (pathname === '/admin-app' || pathname === '/admin-app/') return '/admin-app/shows'
  if (pathname === '/admin-app/shows' || pathname === '/admin-app/orders' || pathname === '/admin-app/artists' || pathname === '/admin-app/discover' || pathname === '/admin-app/settings' || pathname === '/admin-app/scanner') {
    return pathname
  }
  if (pathname.startsWith('/admin-app/scanner/')) return '/admin-app/scanner'
  if (pathname.startsWith('/admin-app/shows/')) return '/admin-app/shows'
  return '/admin-app/shows'
}

export function ClubSwitcher({ clubs, selectedClubId }: ClubSwitcherProps) {
  const pathname = usePathname()
  const { isMobile } = useSidebar()
  const selectedClub = clubs.find((club) => club.id === selectedClubId) ?? clubs[0] ?? null
  const nextPath = getNextPath(pathname)

  if (!selectedClub) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" disabled>
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground overflow-hidden">
              <Image src="/icon.svg" alt="" width={32} height={32} className="rounded-full" />
            </div>
            <div className="flex flex-col gap-0.5 leading-none">
              <span className="font-semibold">No clubs</span>
              <span className="text-xs text-muted-foreground">superadmin</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground overflow-hidden">
                {selectedClub.logo_url ? (
                  <Image src={selectedClub.logo_url} alt="" width={32} height={32} className="h-full w-full object-cover" />
                ) : (
                  <Image src="/icon.svg" alt="" width={32} height={32} className="rounded-full" />
                )}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{selectedClub.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {selectedClub.city ?? 'Select club'}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">Select club</DropdownMenuLabel>
            {clubs.map((club) => (
              <DropdownMenuItem key={club.id} asChild>
                <Link href={`/admin-app/select-club?club=${club.id}&next=${encodeURIComponent(nextPath)}`} className="flex items-center gap-2 p-2">
                  <div className="flex size-6 items-center justify-center rounded-md border overflow-hidden bg-zinc-100">
                    {club.logo_url ? (
                      <Image src={club.logo_url} alt="" width={24} height={24} className="h-full w-full object-cover" />
                    ) : (
                      <Image src="/icon.svg" alt="" width={16} height={16} />
                    )}
                  </div>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-medium">{club.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{club.city ?? 'No city'}</span>
                  </div>
                  <Check className={cn('size-4', selectedClubId === club.id ? 'opacity-100' : 'opacity-0')} />
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}