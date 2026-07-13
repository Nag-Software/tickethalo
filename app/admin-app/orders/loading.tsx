import { Skeleton } from '@/components/ui/skeleton'
import { SkeletonHeader } from '@/components/admin/skeleton-header'

export default function OrdersLoading() {
  return (
    <div>
      <SkeletonHeader />
      <div className="p-6">
        <div className="rounded-lg border p-4 space-y-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full rounded-md" />
          ))}
        </div>
      </div>
    </div>
  )
}
