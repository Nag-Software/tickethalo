import { Skeleton } from '@/components/ui/skeleton'
import { SkeletonHeader } from '@/components/admin/skeleton-header'

export default function MinKlubbLoading() {
  return (
    <div>
      <SkeletonHeader />
      <div className="max-w-3xl space-y-6 p-6">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  )
}
