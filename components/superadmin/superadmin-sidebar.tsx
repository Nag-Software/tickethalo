'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, ExternalLink, Inbox, LayoutDashboard, LogOut, Mic, SlidersHorizontal } from 'lucide-react'
import { BrandMark } from '@/components/brand/brand-logo'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

const NAV = [
  { key: 'overview', label: 'Oversikt', href: '/superadmin/overview', icon: LayoutDashboard },
  { key: 'clubs', label: 'Klubber', href: '/superadmin/clubs', icon: Building2 },
  { key: 'artists', label: 'Komikere', href: '/superadmin/artists', icon: Mic },
  { key: 'beta', label: 'Betasøknader', href: '/superadmin/beta-requests', icon: Inbox },
  { key: 'booking', label: 'Bookingmotoren', href: '/superadmin/booking', icon: SlidersHorizontal },
] as const

/**
 * Menyen for superadmin.
 *
 * Hver side hadde sin egen topplinje med en tilbakepil til klubblisten, og
 * lenkene til resten lå bare der. Nå står alt ett sted, og tallene ved siden
 * av lenkene er det som venter på noen: nye betasøknader og komikere som
 * står til vurdering.
 */
export function SuperadminSidebar({
  email,
  badges,
}: {
  email: string
  badges: Partial<Record<(typeof NAV)[number]['key'], number>>
}) {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/superadmin/overview">
                <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg bg-primary text-primary-foreground">
                  <BrandMark tone="dark" className="size-8 p-1" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">Tickethalo</span>
                  <span className="text-xs text-muted-foreground">Superadmin</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Plattform</SidebarGroupLabel>
          <SidebarMenu>
            {NAV.map((item) => {
              const badge = badges[item.key] ?? 0
              return (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton asChild isActive={pathname.startsWith(item.href)} tooltip={item.label}>
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  {badge > 0 && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Snarveier</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Klubbportalen">
                <Link href="/admin-app/shows">
                  <ExternalLink />
                  <span>Klubbportalen</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="truncate px-2 py-1.5 text-xs text-muted-foreground">{email}</div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Logg ut">
              <form action="/superadmin/logout" method="post">
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
