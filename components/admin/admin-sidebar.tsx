'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { ClubSwitcher } from '@/components/admin/club-switcher'
import {
  Building2,
  Users,
  CalendarDays,
  ShoppingCart,
  Settings,
  LogOut,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

const navItems = [
  { label: 'Shows', href: '/shows', icon: CalendarDays },
  { label: 'Komikere', href: '/artists', icon: Users },
  { label: 'Ordre', href: '/orders', icon: ShoppingCart },
  { label: 'Min klubb', href: '/min-klubb', icon: Building2 },
  { label: 'Innstillinger', href: '/settings', icon: Settings },
]

interface AdminSidebarProps {
  user: { email: string; name: string; role: string; clubName?: string | null }
  clubs?: Array<{ id: string; name: string; city: string | null }>
  selectedClubId?: string | null
  showClubSwitcher?: boolean
}

export function AdminSidebar({ user, clubs = [], selectedClubId = null, showClubSwitcher = false }: AdminSidebarProps) {
  const rawPathname = usePathname()
  const pathPrefix = '/admin-app'
  const pathname = rawPathname.replace(/^\/admin-app/, '') || '/'

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {showClubSwitcher ? (
          <ClubSwitcher clubs={clubs} selectedClubId={selectedClubId} />
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link href={`${pathPrefix}/shows`}>
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Image src="/favicon.svg" className="rounded-full p-0 outline-2 border-1" alt="" width={32} height={32} />
                  </div>
                  <div className="flex flex-col gap-0.5 leading-none">
                    <span className="font-semibold">{user.clubName ?? 'Bookingsystem'}</span>
                    <span className="text-xs text-muted-foreground capitalize">{user.role}</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigasjon</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => {
              const active = pathname.startsWith(item.href)
              const href = `${pathPrefix}${item.href}`
              return (
                <SidebarMenuItem key={item.href + item.label}>
                  <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                    <Link href={href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">{user.email}</div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Logg ut">
              <form action={`${pathPrefix}/logout`} method="post">
                <button type="submit" className="flex w-full items-center gap-2">
                  <LogOut className="size-4" />
                  <span>Logg ut</span>
                </button>
              </form>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
