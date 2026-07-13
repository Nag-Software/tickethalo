import { Skeleton } from '@/components/ui/skeleton'
import { SkeletonHeader } from '@/components/admin/skeleton-header'

export default function ShowDetailLoading() {
  return (
    <div>
      <SkeletonHeader />
      <div className="grid gap-4 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-96 rounded-xl lg:col-span-2" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    </div>
  )
}
