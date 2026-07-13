import { Skeleton } from '@/components/ui/skeleton'
import { SkeletonHeader } from '@/components/admin/skeleton-header'

export default function ShowsLoading() {
  return (
    <div>
      <SkeletonHeader />
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 p-6">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-72 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
