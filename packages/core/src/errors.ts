export class DockoError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly exitCode: number,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DockoError';
  }
}

const SAFE_ID_PATTERN = /^[\w][\w\-.]*$/;

export function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID_PATTERN.test(value) || value.includes('..')) {
    throw new DockoError(
      `Invalid ${label}: must match [\\w][\\w\\-.]*  and must not contain '..'`,
      'INVALID_ID',
      1,
      { [label]: value }
    );
  }
}

export function toErrorPayload(error: unknown): { error: Record<string, unknown> } {
  if (error instanceof DockoError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...error.details
      }
    };
  }

  if (error instanceof Error) {
    return {
      error: {
        code: 'UNEXPECTED_ERROR',
        message: error.message
      }
    };
  }

  return {
    error: {
      code: 'UNEXPECTED_ERROR',
      message: 'Unknown error'
    }
  };
}
