import { Skeleton } from '@/components/ui/skeleton'

export default function AdminLoading() {
  return (
    <div>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Skeleton className="size-8 rounded-md" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </header>
      <main className="grid gap-4 p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </main>
    </div>
  )
}