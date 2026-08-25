'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { ClubSwitcher } from '@/components/admin/club-switcher'
import {
  Building2,
  Users,
  UserSearch,
  CalendarDays,
  ShoppingCart,
  Wallet,
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
  { label: 'Comedians', href: '/artists', icon: Users },
  { label: 'Discover comedians', href: '/discover', icon: UserSearch },
  { label: 'Orders', href: '/orders', icon: ShoppingCart },
  { label: 'Finances', href: '/finances', icon: Wallet },
  { label: 'My club', href: '/my-club', icon: Building2 },
  { label: 'Settings', href: '/settings', icon: Settings },
]

interface AdminSidebarProps {
  user: { email: string; name: string; role: string; clubName?: string | null; clubLogoUrl?: string | null }
  clubs?: Array<{ id: string; name: string; city: string | null; logo_url: string | null }>
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
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground overflow-hidden">
                    {user.clubLogoUrl ? (
                      <Image src={user.clubLogoUrl} alt="" width={32} height={32} className="h-full w-full object-cover" />
                    ) : (
                      <Image src="/icon.svg" alt="" width={32} height={32} className="rounded-full p-0" />
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 leading-none">
                    <span className="font-semibold">{user.clubName ?? 'Booking system'}</span>
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
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => {
              const active = pathname.startsWith(item.href)
              const href = `${pathPrefix}${item.href}`
              return (
                <SidebarMenuItem key={item.href + item.label}>
                  <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                    <Link href={href} className="!text-[15]">
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
            <SidebarMenuButton asChild tooltip="Log out">
              <form action={`${pathPrefix}/logout`} method="post">
                <button type="submit" className="flex w-full items-center gap-2">
                  <LogOut className="size-4" />
                  <span>Log out</span>
                </button>
              </form>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
