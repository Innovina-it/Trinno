import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-10 space-y-6">
      <Skeleton className="h-8 w-48 bg-white/10" />
      <div className="grid grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[60vh] bg-white/5" />
        ))}
      </div>
    </div>
  );
}
