export class PreprError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, code = "PREPR_ERROR", details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function assertPrepr(condition: unknown, message: string, code?: string): asserts condition {
  if (!condition) {
    throw new PreprError(message, code);
  }
}
