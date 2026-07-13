import { Skeleton } from '@/components/ui/skeleton'
import { SkeletonHeader } from '@/components/admin/skeleton-header'

export default function ArtistEconomyLoading() {
  return (
    <div>
      <SkeletonHeader />
      <div className="grid gap-4 p-6">
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}
