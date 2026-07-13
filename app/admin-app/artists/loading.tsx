import { Skeleton } from '@/components/ui/skeleton'
import { SkeletonHeader } from '@/components/admin/skeleton-header'

export default function ArtistsLoading() {
  return (
    <div>
      <SkeletonHeader />
      <div className="p-6 space-y-4">
        <Skeleton className="h-9 w-full max-w-md rounded-md" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-24 rounded-full" />
          ))}
        </div>
        <div className="rounded-lg border p-4 space-y-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full rounded-md" />
          ))}
        </div>
      </div>
    </div>
  )
}
