import { Skeleton } from "@/components/ui/skeleton";

export default function BoardLoading() {
  return (
    <div
      className="-m-6 min-h-[calc(100vh-3rem)] p-4"
      style={{ background: "#0079bf" }}
      aria-busy="true"
    >
      <div className="mb-4 flex items-center justify-between px-2">
        <Skeleton className="h-7 w-48 bg-white/30" />
        <Skeleton className="h-8 w-28 bg-white/30" />
      </div>
      <div className="flex items-start gap-3 px-2 pb-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-black/35 p-2 backdrop-blur-sm ring-1 ring-white/10"
          >
            <Skeleton className="h-5 w-24 bg-white/20" />
            <div className="flex flex-col gap-1.5">
              {[0, 1, 2].map((j) => (
                <Skeleton key={j} className="h-12 w-full rounded-md bg-white/85" />
              ))}
            </div>
            <Skeleton className="h-6 w-full bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}
