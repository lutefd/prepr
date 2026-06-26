export class PreprError extends Error {
  constructor(
    message: string,
    public readonly code = "PREPR_ERROR",
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function assertPrepr(condition: unknown, message: string, code?: string): asserts condition {
  if (!condition) {
    throw new PreprError(message, code);
  }
}
