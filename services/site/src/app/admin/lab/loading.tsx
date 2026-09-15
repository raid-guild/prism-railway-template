import { Skeleton } from "@/components/ui/skeleton"

export default function LabLoading() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8" role="status" aria-live="polite" aria-label="Loading Prism Lab">
      <span className="sr-only">Loading Prism Lab</span>
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="hidden h-9 w-28 sm:block" />
        </div>
        <div className="grid min-h-[28rem] gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(26rem,1.7fr)]">
          <Skeleton className="h-full min-h-72" />
          <Skeleton className="h-full min-h-72" />
        </div>
      </div>
    </div>
  )
}
