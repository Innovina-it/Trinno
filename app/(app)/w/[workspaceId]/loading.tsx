import { Skeleton } from "@/components/ui/skeleton";

export default function WorkspaceLoading() {
  return (
    <main className="space-y-6" aria-busy="true">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-28" />
        </div>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i}>
            <Skeleton className="aspect-[3/2] w-full rounded-xl" />
          </li>
        ))}
      </ul>
    </main>
  );
}
