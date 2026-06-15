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
  ChevronRight,
} from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'

type NavItem = {
  label: string
  href?: string
  icon: React.ComponentType<{ className?: string }>
  children?: Array<{ label: string; href: string }>
}

const navItems: NavItem[] = [
  { label: 'Shows', href: '/shows', icon: CalendarDays },
  { label: 'Komikere', href: '/artists', icon: Users },
  { label: 'Ordre', href: '/orders', icon: ShoppingCart },
  {
    label: 'Min klubb',
    icon: Building2,
    children: [
      { label: 'Branding', href: '/min-klubb' },
      { label: 'Bookingalgoritme', href: '/min-klubb/bookingalgoritme' },
    ],
  },
  { label: 'Innstillinger', href: '/settings', icon: Settings },
]

function isNavChildActive(pathname: string, href: string) {
  if (href === '/min-klubb') {
    return pathname === '/min-klubb' || pathname === '/min-klubb/'
  }
  return pathname.startsWith(href)
}

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
                      <Image src="/favicon.svg" alt="" width={32} height={32} className="rounded-full p-0" />
                    )}
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
              if (item.children) {
                const isGroupActive = item.children.some((child) => isNavChildActive(pathname, child.href))

                return (
                  <Collapsible
                    key={item.label}
                    asChild
                    defaultOpen={isGroupActive}
                    className="group/collapsible"
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip={item.label} isActive={isGroupActive}>
                          <item.icon />
                          <span>{item.label}</span>
                          <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.children.map((child) => {
                            const childActive = isNavChildActive(pathname, child.href)
                            return (
                              <SidebarMenuSubItem key={child.href}>
                                <SidebarMenuSubButton asChild isActive={childActive}>
                                  <Link href={`${pathPrefix}${child.href}`}>
                                    <span>{child.label}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            )
                          })}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                )
              }

              const active = pathname.startsWith(item.href!)
              const href = `${pathPrefix}${item.href}`
              return (
                <SidebarMenuItem key={item.href! + item.label}>
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
