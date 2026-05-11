type OfficeLoadingScreenProps = {
  label?: string;
  detail?: string;
  variant?: "board" | "workspace" | "tasks" | "app";
};

const DETAILS: Record<NonNullable<OfficeLoadingScreenProps["variant"]>, string> = {
  app: "Convincing the tabs to behave.",
  board: "Moving cards without making it everyone else's problem.",
  workspace: "Finding the clean marker in the meeting room.",
  tasks: "Sorting the pile that said it was sorted yesterday.",
};

const LABELS: Record<NonNullable<OfficeLoadingScreenProps["variant"]>, string> = {
  app: "Opening the office",
  board: "Setting the board",
  workspace: "Loading the workspace",
  tasks: "Stacking the tasks",
};

export function OfficeLoadingScreen({
  label,
  detail,
  variant = "app",
}: OfficeLoadingScreenProps) {
  const title = label ?? LABELS[variant];
  const caption = detail ?? DETAILS[variant];

  return (
    <div
      className="office-loader min-h-[calc(100vh-3.5rem)] px-4 py-8 text-fg"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="office-loader__stage mx-auto flex min-h-[min(680px,calc(100vh-7rem))] w-full max-w-5xl flex-col items-center justify-center gap-7">
        <div className="office-loader__desk" aria-hidden="true">
          <div className="office-loader__lamp">
            <span />
          </div>
          <div className="office-loader__monitor">
            <div className="office-loader__monitor-bar" />
            <div className="office-loader__monitor-row office-loader__monitor-row--a" />
            <div className="office-loader__monitor-row office-loader__monitor-row--b" />
            <div className="office-loader__monitor-row office-loader__monitor-row--c" />
            <div className="office-loader__cursor" />
          </div>
          <div className="office-loader__note office-loader__note--one">DUE</div>
          <div className="office-loader__note office-loader__note--two">?</div>
          <div className="office-loader__coffee">
            <span className="office-loader__steam office-loader__steam--one" />
            <span className="office-loader__steam office-loader__steam--two" />
            <span className="office-loader__steam office-loader__steam--three" />
          </div>
          <div className="office-loader__keyboard">
            {Array.from({ length: 12 }).map((_, i) => (
              <span key={i} />
            ))}
          </div>
          <div className="office-loader__deskline" />
        </div>

        <div className="w-full max-w-md space-y-3 text-center">
          <p className="mono-meta-sm text-fg-faint">{title}</p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-fg">
            {caption}
          </h1>
          <div
            className="office-loader__progress mx-auto mt-5 h-1.5 w-64 overflow-hidden rounded-full border border-hairline bg-[color:var(--surface)]"
            aria-hidden="true"
          >
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
