// U6c — hard timeout around an await. A single hung HTTP call (Drive export,
// revisions read, Gemini recap) used to freeze the whole analysis until the
// 6-minute stale-heartbeat reaper killed the run; racing a timer turns the hang
// into a per-file error the pipeline can absorb (the file surfaces as a missed
// update, the run continues).
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
