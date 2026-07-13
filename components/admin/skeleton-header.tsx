import { Skeleton } from '@/components/ui/skeleton'

/** Skeleton som matcher AdminHeader-layouten, til bruk i loading.tsx-filer. */
export function SkeletonHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <Skeleton className="size-7 rounded-md" />
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
    </header>
  )
}
