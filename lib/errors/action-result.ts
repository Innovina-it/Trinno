import {
  toStructuredError,
  type StructuredErrorShape,
} from "./structured-error";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: StructuredErrorShape };

export async function actionResult<T>(
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toStructuredError(err, "ACTION_FAILED") };
  }
}
