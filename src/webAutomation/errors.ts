export type WebAutomationErrorCode =
  | 'not_authorized'
  | 'not_authenticated'
  | 'no_profile'
  | 'http_error'
  | 'invalid_request'
  | 'out_of_scope'
  | 'stopped';

export class WebAutomationError extends Error {
  readonly code: WebAutomationErrorCode;
  readonly status?: number;

  constructor(code: WebAutomationErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'WebAutomationError';
    this.code = code;
    this.status = status;
  }
}

export function errorCode(error: unknown): WebAutomationErrorCode | 'error' {
  return error instanceof WebAutomationError ? error.code : 'error';
}

export function errorStatus(error: unknown): number | undefined {
  return error instanceof WebAutomationError ? error.status : undefined;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
