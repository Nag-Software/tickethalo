import { SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'

interface AdminHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
}

export function AdminHeader({ title, description, actions }: AdminHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold leading-tight">{title}</h1>
          {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
