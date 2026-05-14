export type StructuredErrorShape = {
  code: string;
  message: string;
  context?: unknown;
};

export class StructuredError extends Error implements StructuredErrorShape {
  code: string;
  context?: unknown;

  constructor(code: string, message: string, context?: unknown) {
    super(message);
    this.name = "StructuredError";
    this.code = code;
    this.context = context;
  }

  toJSON(): StructuredErrorShape {
    return {
      code: this.code,
      message: this.message,
      ...(this.context !== undefined ? { context: this.context } : {}),
    };
  }

  static fromUnknown(
    error: unknown,
    fallbackCode = "UNKNOWN_ERROR",
    context?: unknown,
  ): StructuredError {
    if (error instanceof StructuredError) return error;
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { message?: unknown }).message === "string"
    ) {
      return new StructuredError(
        (error as { code: string }).code,
        (error as { message: string }).message,
        "context" in error ? (error as { context?: unknown }).context : context,
      );
    }
    if (error instanceof Error) {
      return new StructuredError(fallbackCode, error.message, context);
    }
    return new StructuredError(fallbackCode, String(error), context);
  }
}

export function toStructuredError(
  error: unknown,
  fallbackCode = "UNKNOWN_ERROR",
  context?: unknown,
): StructuredErrorShape {
  return StructuredError.fromUnknown(error, fallbackCode, context).toJSON();
}
